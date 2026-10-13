"""Persistent retry queue for Central IAM model usage settlements.

The outbox stores only IAM resource UUIDs and usage numbers. Delivery is
at-least-once; IAM request IDs make settle and report operations idempotent.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import and_, create_engine, delete, event, or_, select
from sqlalchemy.orm import Session, sessionmaker

from deerflow.authz.iam_model_usage import IamModelUsageClient
from deerflow.persistence.models.iam_model_usage_outbox import IamModelUsageOutboxRow

logger = logging.getLogger(__name__)
_CENTRAL_IAM_PROVIDER = "deerflow.authz.iam_deerflow:DeerFlowIamAuthorizationProvider"
_LEASE_SECONDS = 120
_MAX_RETRY_SECONDS = 600
_DEFAULT_POLL_SECONDS = 3.0
_stores: dict[tuple[str, str], IamModelUsageOutboxStore] = {}
_stores_lock = threading.Lock()


def _uuid(value: str, label: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValueError(f"{label} must be a UUID") from None


class IamModelUsageOutboxStore:
    """Synchronous SQLAlchemy store used from LangChain callback worker threads."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._Session = session_factory

    @classmethod
    def from_url(cls, url: str, *, postgres_schema: str = "") -> IamModelUsageOutboxStore:
        """Build a SQLite/PostgreSQL store for tests or the configured Gateway."""
        if not isinstance(url, str) or not url.strip():
            raise ValueError("A persistent DeerFlow database URL is required")
        connect_args: dict[str, Any] = {}
        if url.startswith("sqlite"):
            connect_args["check_same_thread"] = False
        elif postgres_schema:
            from deerflow.config.postgres_schema import validate_postgres_schema

            schema = validate_postgres_schema(postgres_schema)
            connect_args["options"] = f"-c search_path={schema}"
        engine = create_engine(url, future=True, pool_pre_ping=True, connect_args=connect_args)
        if url.startswith("sqlite"):

            @event.listens_for(engine, "connect")
            def _enable_sqlite_pragmas(dbapi_conn, _record):  # noqa: ARG001 - SQLAlchemy contract
                cursor = dbapi_conn.cursor()
                try:
                    cursor.execute("PRAGMA journal_mode=WAL;")
                    cursor.execute("PRAGMA synchronous=NORMAL;")
                    cursor.execute("PRAGMA foreign_keys=ON;")
                    cursor.execute("PRAGMA busy_timeout=30000;")
                finally:
                    cursor.close()

        return cls(sessionmaker(engine, expire_on_commit=False))

    def enqueue(self, **payload: Any) -> bool:
        """Persist an immutable event; identical retries are safe, conflicts fail."""
        required = {
            "request_id",
            "tenant_id",
            "model_id",
            "application_id",
            "user_id",
            "action",
            "reserved_input_tokens",
            "reserved_output_tokens",
            "input_tokens",
            "output_tokens",
            "outcome",
            "usage_is_estimated",
            "latency_ms",
        }
        if set(payload) != required:
            raise ValueError("IAM model usage outbox payload has an invalid shape")
        if payload["action"] not in {"settle", "report"} or payload["outcome"] not in {"succeeded", "failed"}:
            raise ValueError("IAM model usage outbox action or outcome is invalid")
        if not isinstance(payload["usage_is_estimated"], bool):
            raise ValueError("usage_is_estimated must be a boolean")
        counts = required.intersection(payload) - {
            "request_id",
            "tenant_id",
            "model_id",
            "application_id",
            "user_id",
            "action",
            "outcome",
            "usage_is_estimated",
        }
        if any(isinstance(payload[key], bool) or not isinstance(payload[key], int) or payload[key] < 0 for key in counts):
            raise ValueError("model usage counts must be non-negative integers")
        normalized = dict(payload)
        for key, label in (
            ("tenant_id", "tenant ID"),
            ("model_id", "model ID"),
            ("application_id", "application ID"),
            ("user_id", "user ID"),
        ):
            normalized[key] = _uuid(normalized[key], label)
        now = datetime.now(UTC)
        with self._Session.begin() as session:
            existing = session.scalar(select(IamModelUsageOutboxRow).where(IamModelUsageOutboxRow.request_id == payload["request_id"]).with_for_update())
            if existing is not None:
                if any(getattr(existing, key) != value for key, value in normalized.items()):
                    raise ValueError("IAM model usage request ID was reused with a different payload")
                return False
            session.add(
                IamModelUsageOutboxRow(
                    **normalized,
                    status="pending",
                    attempt_count=0,
                    next_attempt_at=now,
                    created_at=now,
                    updated_at=now,
                )
            )
        return True

    def dispatch_request(self, request_id: str, client: IamModelUsageClient) -> bool:
        """Try a just-enqueued item immediately while retaining failures for retry."""
        claimed = self._claim(limit=1, request_id=request_id)
        if not claimed:
            return False
        self._deliver(claimed[0], client)
        return True

    def dispatch_due(self, client: IamModelUsageClient, *, limit: int = 10) -> int:
        """Deliver a bounded batch of due rows and return the number attempted."""
        claimed = self._claim(limit=limit)
        for item in claimed:
            self._deliver(item, client)
        return len(claimed)

    def purge_delivered(self, *, retention_days: int = 30) -> int:
        """Delete completed transport records after IAM has accepted them."""
        if isinstance(retention_days, bool) or not isinstance(retention_days, int) or not 1 <= retention_days <= 3650:
            raise ValueError("outbox retention must be between 1 and 3650 days")
        cutoff = datetime.now(UTC) - timedelta(days=retention_days)
        with self._Session.begin() as session:
            result = session.execute(
                delete(IamModelUsageOutboxRow).where(
                    IamModelUsageOutboxRow.status == "delivered",
                    IamModelUsageOutboxRow.delivered_at < cutoff,
                )
            )
            return int(result.rowcount or 0)

    def _claim(self, *, limit: int, request_id: str | None = None) -> list[dict[str, Any]]:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("outbox batch size must be between 1 and 100")
        now = datetime.now(UTC)
        lease_owner = uuid4()
        due_or_abandoned = or_(
            and_(IamModelUsageOutboxRow.status == "pending", IamModelUsageOutboxRow.next_attempt_at <= now),
            and_(IamModelUsageOutboxRow.status == "processing", IamModelUsageOutboxRow.lease_until <= now),
        )
        statement = select(IamModelUsageOutboxRow).where(due_or_abandoned)
        if request_id is not None:
            statement = statement.where(IamModelUsageOutboxRow.request_id == request_id)
        statement = statement.order_by(IamModelUsageOutboxRow.created_at).limit(limit).with_for_update(skip_locked=True)
        with self._Session.begin() as session:
            rows = list(session.scalars(statement))
            claimed: list[dict[str, Any]] = []
            for row in rows:
                row.status = "processing"
                row.lease_owner = lease_owner
                row.lease_until = now + timedelta(seconds=_LEASE_SECONDS)
                row.updated_at = now
                claimed.append(
                    {
                        "request_id": row.request_id,
                        "tenant_id": str(row.tenant_id),
                        "model_id": str(row.model_id),
                        "application_id": str(row.application_id),
                        "user_id": str(row.user_id),
                        "action": row.action,
                        "input_tokens": row.input_tokens,
                        "output_tokens": row.output_tokens,
                        "outcome": row.outcome,
                        "usage_is_estimated": row.usage_is_estimated,
                        "latency_ms": row.latency_ms,
                        "lease_owner": lease_owner,
                    }
                )
        return claimed

    def _deliver(self, item: Mapping[str, Any], client: IamModelUsageClient) -> None:
        try:
            arguments = {
                "request_id": item["request_id"],
                "input_tokens": item["input_tokens"],
                "output_tokens": item["output_tokens"],
                "outcome": item["outcome"],
                "usage_is_estimated": item["usage_is_estimated"],
                "latency_ms": item["latency_ms"],
            }
            if item["action"] == "settle":
                client.settle_usage(**arguments)
            else:
                client.report_usage(
                    tenant_id=item["tenant_id"],
                    model_id=item["model_id"],
                    application_id=item["application_id"],
                    user_id=item["user_id"],
                    **arguments,
                )
        except Exception as exc:
            self._schedule_retry(item, exc)
            return
        now = datetime.now(UTC)
        with self._Session.begin() as session:
            row = session.scalar(
                select(IamModelUsageOutboxRow)
                .where(
                    IamModelUsageOutboxRow.request_id == item["request_id"],
                    IamModelUsageOutboxRow.status == "processing",
                    IamModelUsageOutboxRow.lease_owner == item["lease_owner"],
                )
                .with_for_update()
            )
            if row is not None:
                row.status = "delivered"
                row.delivered_at = now
                row.updated_at = now
                row.lease_owner = None
                row.lease_until = None
                row.last_error_class = None

    def _schedule_retry(self, item: Mapping[str, Any], exc: Exception) -> None:
        now = datetime.now(UTC)
        error_class = type(exc).__name__[:120]
        with self._Session.begin() as session:
            row = session.scalar(
                select(IamModelUsageOutboxRow)
                .where(
                    IamModelUsageOutboxRow.request_id == item["request_id"],
                    IamModelUsageOutboxRow.status == "processing",
                    IamModelUsageOutboxRow.lease_owner == item["lease_owner"],
                )
                .with_for_update()
            )
            if row is None:
                return
            row.attempt_count += 1
            row.next_attempt_at = now + timedelta(seconds=min(_MAX_RETRY_SECONDS, 2 ** min(row.attempt_count, 10)))
            row.status = "pending"
            row.lease_owner = None
            row.lease_until = None
            row.last_error_class = error_class
            row.updated_at = now
        logger.warning(
            "IAM model usage outbox delivery failed for request %s (%s)",
            item["request_id"],
            error_class,
        )


def get_iam_model_usage_outbox_store(database_config: Any) -> IamModelUsageOutboxStore:
    """Reuse one connection pool per configured application database."""
    backend = getattr(database_config, "backend", None)
    if backend not in {"sqlite", "postgres"}:
        raise ValueError("IAM model usage requires a persistent SQLite or PostgreSQL database")
    url = getattr(database_config, "app_sync_sqlalchemy_url", None)
    if not isinstance(url, str) or not url:
        raise ValueError("IAM model usage requires a persistent DeerFlow database URL")
    schema = getattr(database_config, "postgres_schema", "") if backend == "postgres" else ""
    key = (url, schema)
    store = _stores.get(key)
    if store is not None:
        return store
    with _stores_lock:
        store = _stores.get(key)
        if store is None:
            store = IamModelUsageOutboxStore.from_url(url, postgres_schema=schema)
            _stores[key] = store
    return store


class IamModelUsageOutboxService:
    """Gateway-lifetime retry loop; pending rows survive process restarts."""

    def __init__(
        self,
        *,
        store: IamModelUsageOutboxStore,
        client: IamModelUsageClient,
        poll_seconds: float = _DEFAULT_POLL_SECONDS,
        retention_days: int = 30,
    ) -> None:
        if not 0 < poll_seconds <= 60:
            raise ValueError("outbox poll interval must be between 0 and 60 seconds")
        if isinstance(retention_days, bool) or not isinstance(retention_days, int) or not 1 <= retention_days <= 3650:
            raise ValueError("outbox retention must be between 1 and 3650 days")
        self._store, self._client, self._poll_seconds = store, client, poll_seconds
        self._retention_days = retention_days
        self._last_purge = 0.0
        self._stop = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="iam-model-usage-outbox")

    async def stop(self) -> None:
        task = self._task
        if task is None:
            return
        self._stop.set()
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=10)
        except TimeoutError:
            logger.warning("IAM model usage outbox worker exceeded shutdown budget; pending rows remain durable")
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        finally:
            self._task = None

    async def _run(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.to_thread(self._store.dispatch_due, self._client)
                now = time.monotonic()
                if now - self._last_purge >= 3600:
                    await asyncio.to_thread(
                        self._store.purge_delivered,
                        retention_days=self._retention_days,
                    )
                    self._last_purge = now
            except Exception as exc:
                logger.warning("IAM model usage outbox worker failed (%s)", type(exc).__name__)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._poll_seconds)
            except TimeoutError:
                pass


def build_iam_model_usage_outbox_service(app_config: Any, *, environ: Mapping[str, str] | None = None) -> IamModelUsageOutboxService | None:
    """Build the retry worker only for opted-in Central IAM usage."""
    authorization = getattr(app_config, "authorization", None)
    provider = getattr(authorization, "provider", None)
    if provider is None or getattr(provider, "use", None) != _CENTRAL_IAM_PROVIDER:
        return None
    provider_config = getattr(provider, "config", None)
    if not isinstance(provider_config, Mapping):
        return None
    usage_config = provider_config.get("model_usage")
    if not isinstance(usage_config, Mapping) or usage_config.get("enabled") is not True:
        return None
    if getattr(authorization, "enabled", False) is not True:
        raise ValueError("Central IAM authorization must be enabled before model usage metering")
    env = os.environ if environ is None else environ
    key = env.get("IAM_MODEL_USAGE_API_KEY")
    if not isinstance(key, str) or len(key) < 32:
        raise ValueError("IAM_MODEL_USAGE_API_KEY must contain at least 32 characters")
    base_url = provider_config.get("api_base_url")
    if not isinstance(base_url, str) or not base_url.strip():
        raise ValueError("Central IAM api_base_url is required for model usage metering")
    database = getattr(app_config, "database", None)
    if database is None:
        raise ValueError("Persistent DeerFlow database configuration is required for model usage metering")
    timeout = provider_config.get("timeout_seconds", 3.0)
    client = IamModelUsageClient(base_url, key, timeout_seconds=timeout)
    return IamModelUsageOutboxService(
        store=get_iam_model_usage_outbox_store(database),
        client=client,
    )
