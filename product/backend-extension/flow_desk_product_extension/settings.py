"""自有产品用户设置的迁移生命周期与按用户隔离的数据仓储。"""

from __future__ import annotations

import asyncio
import hashlib
import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from alembic import command
from alembic.config import Config
from deerflow_extension_api import (
    AdminActionEvent,
    ExtensionRuntimeDeps,
    OwnerFileEntry,
    OwnerFilePage,
)
from sqlalchemy import delete, insert, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from flow_desk_product_extension.data_job_authorization import data_job_authorization_key
from flow_desk_product_extension.models import (
    audit_events,
    data_job_rate_limits,
    data_jobs,
    file_catalog_entries,
    file_catalog_state,
    product_settings,
    user_settings,
)

# 固定锁键只用于串行化本产品自己的 schema upgrade，不与 Gateway 的锁共享。
_POSTGRES_MIGRATION_LOCK = 5064664224210885451
_MAX_SETTING_BYTES = 64 * 1024
_PRODUCT_CONFIG_KEY = "runtime"
_DATA_JOB_KINDS = {"export", "deletion"}
_DATA_JOB_SCOPES = {
    "threads",
    "files",
    "agents",
    "projects",
    "scheduled_tasks",
    "memory",
    "preferences",
    "account",
}
_DATA_JOB_TERMINAL = {"completed", "partial", "failed", "cancelled"}
_DATA_JOB_MAX_ATTEMPTS = 10
_DATA_JOB_CREATES_PER_HOUR = 10
_DATA_JOB_RATE_WINDOW = timedelta(hours=1)
_DATA_JOB_PROGRESS_MAX_BYTES = 4 * 1024
_DATA_JOB_RESULT_MAX_BYTES = 16 * 1024
_DATA_JOB_PROGRESS_STAGES = {
    "queued",
    "starting",
    "inventory",
    "history",
    "files",
    "packaging",
    "deleting",
    "finalizing",
}
_DATA_JOB_RESULT_KEYS = {
    "artifact_id",
    "size_bytes",
    "sha256",
    "completeness",
    "failed_resources_count",
    "deleted_resources_count",
    "remaining_resources_count",
    "expires_at",
}
_FILE_CATALOG_LIMIT = 10_000
_FILE_CATALOG_TTL = timedelta(minutes=5)
_FILE_CATALOG_REFRESH_INTERVAL = timedelta(seconds=30)
_FILE_CATALOG_REFRESH_LEASE = timedelta(minutes=5)
_FILE_CATALOG_INSERT_BATCH = 50
_FILE_CATALOG_SOURCES = {
    "thread_upload",
    "thread_output",
    "thread_workspace",
    "project_document",
}
_FILE_CATALOG_STALE_NOTE = (
    "The saved file catalog may not include the latest changes. "
    "Refresh it before relying on its coverage."
)
_FILE_CATALOG_REFRESH_FAILED_NOTE = (
    "A file catalog refresh failed; the previous saved snapshot is shown."
)


@dataclass(frozen=True)
class CachedOwnerFilePage:
    """产品扩展持久目录的分页结果，不向前端暴露 Gateway 宿主路径。"""

    files: tuple[OwnerFileEntry, ...]
    total: int
    has_more: bool
    next_offset: int | None
    truncated: bool
    failed_count: int
    coverage_notes: tuple[str, ...]
    catalog_updated_at: datetime | None
    catalog_stale: bool
    catalog_refresh_deferred: bool


class DataJobIdempotencyConflict(Exception):
    """同一个用户的幂等键已被不同的任务类型或范围使用。"""


class DataJobInProgressConflict(Exception):
    """每个 owner 最多一个 queued/running/retry_wait 任务。"""


class DataJobRateLimitError(Exception):
    """一个固定一小时窗口内的数据任务创建次数已达到上限。"""

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__("Data job creation rate limit exceeded")
        self.retry_after_seconds = retry_after_seconds


class ProductConfigVersionConflict(Exception):
    """当前配置版本已变化，调用方应重新读取而不是覆盖他人的更新。"""

    def __init__(self, current_version: int) -> None:
        super().__init__(f"Product config version changed to {current_version}")
        self.current_version = current_version


class ProductSettingsStore:
    """管理产品自己的 migration chain 和用户设置数据。

    session factory 由 Gateway 在数据库初始化后注入。所有查询都将可信
    principal 的 user_id 作为第一条件，浏览器不能通过改请求参数切换所有者。
    """

    def __init__(self) -> None:
        self._session_factory: async_sessionmaker[AsyncSession] | None = None
        self._migration_lock = asyncio.Lock()
        self._product_data_directory: Path | None = None
        self._owner_data_reader: Any | None = None
        self._owner_data_deleter: Any | None = None
        self._owner_data_authorizer: Any | None = None
        self._data_job_worker: Any | None = None

    async def start(self, deps: ExtensionRuntimeDeps) -> None:
        """Gateway 启动期先完成自有迁移，再开放产品设置 API。"""
        session_factory = deps.session_factory
        bind = getattr(session_factory, "kw", {}).get("bind")
        if bind is None or not hasattr(bind, "connect"):
            raise RuntimeError("Flow Desk settings require the Gateway async session factory")
        if deps.product_data_directory is not None and deps.owner_data_authorizer is None:
            raise RuntimeError("Flow Desk data jobs require the Gateway owner-data authorizer")

        async with self._migration_lock:
            await self._upgrade_schema(bind)
        # PostgreSQL 表显式放在 product schema；SQLite 没有 schema 概念，
        # 只在这个自有 session factory 上把逻辑 schema 映射到 main。
        product_bind = (
            bind.execution_options(schema_translate_map={"product": None})
            if bind.dialect.name == "sqlite"
            else bind
        )
        self._session_factory = async_sessionmaker(
            product_bind,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        self._product_data_directory = deps.product_data_directory
        self._owner_data_reader = deps.owner_data_reader
        self._owner_data_deleter = getattr(deps, "owner_data_deleter", None)
        self._owner_data_authorizer = getattr(deps, "owner_data_authorizer", None)
        if self._product_data_directory is not None:
            # 用户导出属于 Gateway 生命周期服务；只在宿主显式授予持久目录时启动。
            from flow_desk_product_extension.jobs import DataJobWorker

            self._data_job_worker = DataJobWorker(
                self,
                self._product_data_directory / "artifacts",
                owner_data_reader=self._owner_data_reader,
                owner_data_deleter=self._owner_data_deleter,
                owner_data_authorizer=self._owner_data_authorizer,
            )
            await self._data_job_worker.start()

    async def stop(self) -> None:
        """释放 Gateway 注入的引用；Engine 生命周期仍归 Gateway 所有。"""
        if self._data_job_worker is not None:
            await self._data_job_worker.stop()
            self._data_job_worker = None
        self._session_factory = None
        self._product_data_directory = None
        self._owner_data_reader = None
        self._owner_data_deleter = None
        self._owner_data_authorizer = None

    @property
    def can_delete_scheduled_task_definitions(self) -> bool:
        """只在 Gateway 同时授予 owner 清单读取和删除能力时开放该删除范围。"""
        reader = self._owner_data_reader
        deleter = self._owner_data_deleter
        return callable(getattr(reader, "list_scheduled_tasks", None)) and callable(
            getattr(deleter, "delete_scheduled_task", None)
        )

    @property
    def can_delete_custom_agents(self) -> bool:
        """只在 Gateway 同时提供 Agent owner 清单与独立删除能力时开放。"""
        reader = self._owner_data_reader
        deleter = self._owner_data_deleter
        return callable(getattr(reader, "list_agents", None)) and callable(
            getattr(deleter, "delete_agent", None)
        )

    @property
    def can_delete_thread_history(self) -> bool:
        """仅在 Gateway 同时提供 owner 会话清单和宿主删除能力时开放。"""
        reader = self._owner_data_reader
        deleter = self._owner_data_deleter
        return callable(getattr(reader, "list_threads", None)) and callable(
            getattr(deleter, "delete_thread", None)
        )

    @property
    def can_delete_projects(self) -> bool:
        """仅在 Gateway 提供 owner 项目清单及回收站语义删除能力时开放。"""
        reader = self._owner_data_reader
        deleter = self._owner_data_deleter
        return (
            callable(getattr(reader, "list_projects", None))
            and getattr(deleter, "supports_project_delete", False) is True
            and callable(getattr(deleter, "delete_project", None))
        )

    @property
    def can_delete_memory(self) -> bool:
        """仅在当前 Gateway 后端确实支持 owner 范围清空时开放记忆删除。"""
        deleter = self._owner_data_deleter
        return getattr(deleter, "supports_memory_clear", False) is True and callable(
            getattr(deleter, "delete_memory", None)
        )

    @property
    def can_delete_files(self) -> bool:
        """仅在 Gateway 同时提供 owner 文件清单与窄范围删除入口时开放。"""
        reader = self._owner_data_reader
        deleter = self._owner_data_deleter
        return (
            callable(getattr(reader, "list_files", None))
            and getattr(deleter, "supports_file_delete", False) is True
            and callable(getattr(deleter, "delete_file", None))
        )

    async def create_data_job(
        self,
        *,
        owner_user_id: str,
        kind: str,
        idempotency_key: str,
        scope: list[str],
        request_id: str | None = None,
        max_attempts: int = 5,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        """持久化用户任务；只写范围元数据，不接受数据正文或文件内容。"""
        session_factory = self._require_session_factory()
        if not owner_user_id or len(owner_user_id) > 255:
            raise ValueError("Invalid data job owner")
        if kind not in _DATA_JOB_KINDS:
            raise ValueError("Unsupported data job kind")
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", idempotency_key):
            raise ValueError("Invalid data job idempotency key")
        if request_id is not None and not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", request_id):
            raise ValueError("Invalid data job request id")
        if not 1 <= max_attempts <= _DATA_JOB_MAX_ATTEMPTS:
            raise ValueError(f"max_attempts must be between 1 and {_DATA_JOB_MAX_ATTEMPTS}")
        if not scope or any(
            not isinstance(item, str) or item not in _DATA_JOB_SCOPES for item in scope
        ):
            raise ValueError("Invalid data job scope")
        if kind == "deletion" and "account" in scope:
            raise ValueError("Account-wide deletion is not implemented")

        normalized_scope = sorted(set(scope))
        timestamp = now or datetime.now(UTC)
        job_id = str(uuid4())
        values = {
            "job_id": job_id,
            "owner_user_id": owner_user_id,
            "kind": kind,
            "authorization_key": data_job_authorization_key(kind, normalized_scope[0]),
            "idempotency_key": idempotency_key,
            "request_id": request_id,
            "scope": normalized_scope,
            "status": "queued",
            "progress": {"stage": "queued", "completed": 0, "total": 0},
            "result": None,
            "error_code": None,
            "attempt": 0,
            "max_attempts": max_attempts,
            "available_at": timestamp,
            "lease_owner": None,
            "lease_token": None,
            "lease_expires_at": None,
            "cancel_requested": False,
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        try:
            async with session_factory() as session, session.begin():
                dialect = session.bind.dialect.name if session.bind is not None else ""
                if dialect == "postgresql":
                    insert_statement = postgres_insert(data_jobs)
                    rate_insert = postgres_insert(data_job_rate_limits)
                elif dialect == "sqlite":
                    insert_statement = sqlite_insert(data_jobs)
                    rate_insert = sqlite_insert(data_job_rate_limits)
                else:
                    raise RuntimeError(f"Unsupported product jobs database: {dialect}")

                # 对 owner 的计数行加数据库行锁，使多个 Gateway 同时接收创建请求时
                # 共用同一计数窗口。SQLite 的 INSERT 也会先取得写锁。
                await session.execute(
                    rate_insert.values(
                        owner_user_id=owner_user_id,
                        window_started_at=timestamp,
                        request_count=0,
                    ).on_conflict_do_nothing(index_elements=[data_job_rate_limits.c.owner_user_id])
                )
                rate_row = (
                    await session.execute(
                        select(
                            data_job_rate_limits.c.window_started_at,
                            data_job_rate_limits.c.request_count,
                        )
                        .where(data_job_rate_limits.c.owner_user_id == owner_user_id)
                        .with_for_update()
                    )
                ).one()
                window_started_at = rate_row.window_started_at
                if window_started_at.tzinfo is None:
                    window_started_at = window_started_at.replace(tzinfo=UTC)
                request_count = rate_row.request_count
                if timestamp >= window_started_at + _DATA_JOB_RATE_WINDOW:
                    window_started_at = timestamp
                    request_count = 0
                    await session.execute(
                        update(data_job_rate_limits)
                        .where(data_job_rate_limits.c.owner_user_id == owner_user_id)
                        .values(window_started_at=window_started_at, request_count=0)
                    )

                # 同一 Idempotency-Key 的重放返回原任务，不消耗窗口额度。
                existing = (
                    (
                        await session.execute(
                            select(data_jobs).where(
                                data_jobs.c.owner_user_id == owner_user_id,
                                data_jobs.c.idempotency_key == idempotency_key,
                            )
                        )
                    )
                    .mappings()
                    .first()
                )
                if existing is not None:
                    if existing["kind"] != kind or existing["scope"] != normalized_scope:
                        raise DataJobIdempotencyConflict(
                            "The idempotency key is already used for a different request"
                        )
                    return self._public_data_job(existing)

                if request_count >= _DATA_JOB_CREATES_PER_HOUR:
                    retry_after = (
                        window_started_at + _DATA_JOB_RATE_WINDOW - timestamp
                    ).total_seconds()
                    raise DataJobRateLimitError(max(1, int(retry_after) + 1))

                inserted = await session.execute(
                    insert_statement.values(**values).on_conflict_do_nothing(
                        index_elements=[data_jobs.c.owner_user_id, data_jobs.c.idempotency_key]
                    )
                )
                row = (
                    (
                        await session.execute(
                            select(data_jobs).where(
                                data_jobs.c.owner_user_id == owner_user_id,
                                data_jobs.c.idempotency_key == idempotency_key,
                            )
                        )
                    )
                    .mappings()
                    .one()
                )
                if inserted.rowcount:
                    await session.execute(
                        update(data_job_rate_limits)
                        .where(
                            data_job_rate_limits.c.owner_user_id == owner_user_id,
                            data_job_rate_limits.c.window_started_at == window_started_at,
                            data_job_rate_limits.c.request_count == request_count,
                        )
                        .values(request_count=request_count + 1)
                    )
                    await session.execute(
                        insert(audit_events).values(
                            event_id=str(uuid4()),
                            actor_user_id=owner_user_id,
                            action=f"data.{kind}.requested",
                            resource_type="data_job",
                            resource_id=job_id,
                            outcome="success",
                            occurred_at=timestamp,
                            request_id=request_id,
                        )
                    )
                elif row["kind"] != kind or row["scope"] != normalized_scope:
                    raise DataJobIdempotencyConflict(
                        "The idempotency key is already used for a different request"
                    )
                return self._public_data_job(row)
        except IntegrityError as exc:
            constraint_name = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
            sqlite_unique_message = "UNIQUE constraint failed: flowdesk_data_jobs.owner_user_id"
            if (
                constraint_name == "uq_flowdesk_data_jobs_active_owner"
                or sqlite_unique_message in str(exc.orig)
            ):
                raise DataJobInProgressConflict("This user already has an active data job") from exc
            raise

    async def get_data_job(self, owner_user_id: str, job_id: str) -> dict[str, Any] | None:
        """只允许任务 owner 读取任务，内部 lease token 不出此仓储层。"""
        session_factory = self._require_session_factory()
        async with session_factory() as session:
            row = (
                (
                    await session.execute(
                        select(data_jobs).where(
                            data_jobs.c.job_id == job_id,
                            data_jobs.c.owner_user_id == owner_user_id,
                        )
                    )
                )
                .mappings()
                .first()
            )
        return self._public_data_job(row) if row is not None else None

    async def data_job_artifact_path(
        self,
        owner_user_id: str,
        job_id: str,
        *,
        audit_download: bool = False,
        request_id: str | None = None,
        now: datetime | None = None,
    ) -> Path | None:
        """返回 owner 可下载且未过期的导出文件路径，不公开宿主绝对路径。"""
        job = await self.get_data_job(owner_user_id, job_id)
        if (
            job is None
            or job["kind"] != "export"
            or job["status"] != "completed"
            or self._product_data_directory is None
        ):
            return None
        result = job.get("result") or {}
        artifact_id = result.get("artifact_id")
        expires_at = result.get("expires_at")
        if not isinstance(artifact_id, str) or not re.fullmatch(r"[a-f0-9-]{36}", artifact_id):
            return None
        if not isinstance(expires_at, str):
            return None
        try:
            expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except ValueError:
            return None
        timestamp = now or datetime.now(UTC)
        if expiry.tzinfo is None or expiry <= timestamp:
            return None
        path = self._product_data_directory / "artifacts" / f"{artifact_id}.json"
        if not path.is_file():
            return None
        if audit_download:
            # 只记录“已授权的下载请求”元数据；不读取或复制导出文件内容到审计表。
            session_factory = self._require_session_factory()
            async with session_factory() as session, session.begin():
                await session.execute(
                    insert(audit_events).values(
                        event_id=str(uuid4()),
                        actor_user_id=owner_user_id,
                        action="data.export.download_requested",
                        resource_type="data_job",
                        resource_id=job_id,
                        outcome="success",
                        occurred_at=timestamp,
                        request_id=request_id,
                    )
                )
        return path

    async def delete_user_preferences_for_job(
        self,
        *,
        owner_user_id: str,
        job_id: str,
        lease_token: str,
        now: datetime | None = None,
    ) -> int | None:
        """在同一事务内确认租约、删除 owner 偏好并完成任务，避免取消竞态。"""
        timestamp = now or datetime.now(UTC)
        session_factory = self._require_session_factory()
        async with session_factory() as session, session.begin():
            current = (
                await session.execute(
                    select(data_jobs.c.cancel_requested, data_jobs.c.request_id)
                    .where(
                        data_jobs.c.job_id == job_id,
                        data_jobs.c.owner_user_id == owner_user_id,
                        data_jobs.c.kind == "deletion",
                        data_jobs.c.status == "running",
                        data_jobs.c.lease_token == lease_token,
                        data_jobs.c.lease_expires_at > timestamp,
                    )
                    .with_for_update()
                )
            ).first()
            if current is None or current.cancel_requested:
                return None

            deleted = await session.execute(
                delete(user_settings).where(user_settings.c.user_id == owner_user_id)
            )
            count = max(deleted.rowcount or 0, 0)
            updated = await session.execute(
                update(data_jobs)
                .where(
                    data_jobs.c.job_id == job_id,
                    data_jobs.c.owner_user_id == owner_user_id,
                    data_jobs.c.kind == "deletion",
                    data_jobs.c.status == "running",
                    data_jobs.c.lease_token == lease_token,
                    data_jobs.c.lease_expires_at > timestamp,
                    data_jobs.c.cancel_requested.is_(False),
                )
                .values(
                    status="completed",
                    progress={"stage": "finalizing", "completed": 1, "total": 1},
                    result={"deleted_resources_count": count, "remaining_resources_count": 0},
                    error_code=None,
                    lease_owner=None,
                    lease_token=None,
                    lease_expires_at=None,
                    updated_at=timestamp,
                )
            )
            if not updated.rowcount:
                # 若租约在清除时失效，回滚偏好删除，绝不留下未完成却已清空的任务。
                raise RuntimeError("Data deletion lease expired before commit")
            await session.execute(
                insert(audit_events).values(
                    event_id=str(uuid4()),
                    actor_user_id=owner_user_id,
                    action="data.deletion.completed",
                    resource_type="data_job",
                    resource_id=job_id,
                    outcome="success",
                    occurred_at=timestamp,
                    request_id=current.request_id,
                )
            )
        return count

    async def get_data_job_control(
        self,
        job_id: str,
        lease_token: str,
        *,
        now: datetime | None = None,
    ) -> dict[str, Any] | None:
        """Worker 按当前租约读取取消信号；旧 token 不能读取新一轮状态。"""
        session_factory = self._require_session_factory()
        timestamp = now or datetime.now(UTC)
        async with session_factory() as session:
            row = (
                (
                    await session.execute(
                        select(
                            data_jobs.c.cancel_requested,
                            data_jobs.c.lease_expires_at,
                        ).where(
                            data_jobs.c.job_id == job_id,
                            data_jobs.c.status == "running",
                            data_jobs.c.lease_token == lease_token,
                            data_jobs.c.lease_expires_at > timestamp,
                        )
                    )
                )
                .mappings()
                .first()
            )
        return dict(row) if row is not None else None

    async def list_data_jobs(
        self,
        owner_user_id: str,
        *,
        limit: int = 50,
        offset: int = 0,
        authorization_keys: Sequence[str] | None = None,
    ) -> list[dict[str, Any]]:
        """按可信 owner 和当前授权键过滤后分页读取任务。"""
        # API 对外最多每页 100 条；多出的第 101 条仅供 Router 判断 has_more，
        # 不会包含在返回给浏览器的数据页中。
        if not 1 <= limit <= 101 or offset < 0:
            raise ValueError("Invalid data job page")
        session_factory = self._require_session_factory()
        async with session_factory() as session:
            filters = [data_jobs.c.owner_user_id == owner_user_id]
            if authorization_keys is not None:
                # NULL 只会出现在滚动升级时由旧进程写入的新任务；API 会逐条重新授权。
                visible_key_filter = data_jobs.c.authorization_key.is_(None)
                if authorization_keys:
                    visible_key_filter = or_(
                        visible_key_filter,
                        data_jobs.c.authorization_key.in_(set(authorization_keys)),
                    )
                filters.append(visible_key_filter)
            rows = (
                (
                    await session.execute(
                        select(data_jobs)
                        .where(*filters)
                        .order_by(data_jobs.c.created_at.desc(), data_jobs.c.job_id.desc())
                        .limit(limit)
                        .offset(offset)
                    )
                )
                .mappings()
                .all()
            )
        return [self._public_data_job(row) for row in rows]

    async def list_data_job_authorization_keys(self, owner_user_id: str) -> list[str]:
        """读取当前 owner 实际存在的授权类别，不加载任务正文或任务历史。"""
        session_factory = self._require_session_factory()
        async with session_factory() as session:
            rows = await session.execute(
                select(data_jobs.c.authorization_key)
                .where(
                    data_jobs.c.owner_user_id == owner_user_id,
                    data_jobs.c.authorization_key.is_not(None),
                )
                .distinct()
                .order_by(data_jobs.c.authorization_key)
            )
            return [str(key) for key in rows.scalars().all()]

    async def claim_data_job(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> dict[str, Any] | None:
        """以 CAS 租约领取任务；过期执行者的 token 会被后续领取栅栏掉。"""
        if not worker_id or len(worker_id) > 128:
            raise ValueError("Invalid data job worker id")
        if not 5 <= lease_seconds <= 3600:
            raise ValueError("lease_seconds must be between 5 and 3600")
        session_factory = self._require_session_factory()
        timestamp = now or datetime.now(UTC)
        new_token = str(uuid4())

        async with session_factory() as session, session.begin():
            expired = (data_jobs.c.status == "running") & (
                data_jobs.c.lease_expires_at <= timestamp
            )
            await session.execute(
                update(data_jobs)
                .where(expired, data_jobs.c.cancel_requested.is_(True))
                .values(
                    status="cancelled",
                    error_code="cancelled_by_owner",
                    lease_owner=None,
                    lease_token=None,
                    lease_expires_at=None,
                    updated_at=timestamp,
                )
            )
            await session.execute(
                update(data_jobs)
                .where(
                    expired,
                    data_jobs.c.cancel_requested.is_(False),
                    data_jobs.c.attempt >= data_jobs.c.max_attempts,
                )
                .values(
                    status="failed",
                    error_code="worker_lease_exhausted",
                    lease_owner=None,
                    lease_token=None,
                    lease_expires_at=None,
                    updated_at=timestamp,
                )
            )
            candidate = (
                (
                    await session.execute(
                        select(
                            data_jobs.c.job_id,
                            data_jobs.c.status,
                            data_jobs.c.attempt,
                            data_jobs.c.lease_token,
                        )
                        .where(
                            data_jobs.c.cancel_requested.is_(False),
                            data_jobs.c.attempt < data_jobs.c.max_attempts,
                            (
                                (
                                    data_jobs.c.status.in_(("queued", "retry_wait"))
                                    & (data_jobs.c.available_at <= timestamp)
                                )
                                | expired
                            ),
                        )
                        .order_by(data_jobs.c.created_at, data_jobs.c.job_id)
                        .limit(1)
                    )
                )
                .mappings()
                .first()
            )
            if candidate is None:
                return None

            if candidate["status"] == "running":
                claim_condition = (
                    (data_jobs.c.status == "running")
                    & (data_jobs.c.lease_token == candidate["lease_token"])
                    & (data_jobs.c.lease_expires_at <= timestamp)
                )
            else:
                claim_condition = (data_jobs.c.status == candidate["status"]) & (
                    data_jobs.c.available_at <= timestamp
                )
            claimed = await session.execute(
                update(data_jobs)
                .where(
                    data_jobs.c.job_id == candidate["job_id"],
                    data_jobs.c.attempt == candidate["attempt"],
                    data_jobs.c.attempt < data_jobs.c.max_attempts,
                    data_jobs.c.cancel_requested.is_(False),
                    claim_condition,
                )
                .values(
                    status="running",
                    attempt=data_jobs.c.attempt + 1,
                    progress={"stage": "starting", "completed": 0, "total": 0},
                    lease_owner=worker_id,
                    lease_token=new_token,
                    lease_expires_at=timestamp + timedelta(seconds=lease_seconds),
                    updated_at=timestamp,
                )
            )
            if not claimed.rowcount:
                return None
            row = (
                (
                    await session.execute(
                        select(data_jobs).where(data_jobs.c.job_id == candidate["job_id"])
                    )
                )
                .mappings()
                .one()
            )
            result = self._public_data_job(row)
            result.update(
                owner_user_id=row["owner_user_id"],
                lease_owner=row["lease_owner"],
                lease_token=row["lease_token"],
                lease_expires_at=row["lease_expires_at"],
                cancel_requested=row["cancel_requested"],
            )
            return result

    async def update_data_job_progress(
        self,
        *,
        job_id: str,
        lease_token: str,
        progress: dict[str, Any],
        now: datetime | None = None,
        lease_seconds: int = 60,
    ) -> bool:
        """只接受持有当前 token 的 worker 更新小型进度元数据并续约。"""
        if (
            not isinstance(progress, dict)
            or len(_json_bytes(progress)) > _DATA_JOB_PROGRESS_MAX_BYTES
        ):
            raise ValueError("Data job progress must be a small JSON object")
        if set(progress) - {"stage", "completed", "total"}:
            raise ValueError("Data job progress contains unsupported fields")
        stage = progress.get("stage")
        if not isinstance(stage, str) or stage not in _DATA_JOB_PROGRESS_STAGES:
            raise ValueError("Invalid data job progress stage")
        completed = progress.get("completed", 0)
        total = progress.get("total", 0)
        if (
            isinstance(completed, bool)
            or not isinstance(completed, int)
            or completed < 0
            or isinstance(total, bool)
            or not isinstance(total, int)
            or total < completed
        ):
            raise ValueError("Invalid data job progress counts")
        if not 5 <= lease_seconds <= 3600:
            raise ValueError("lease_seconds must be between 5 and 3600")
        timestamp = now or datetime.now(UTC)
        session_factory = self._require_session_factory()
        async with session_factory() as session, session.begin():
            result = await session.execute(
                update(data_jobs)
                .where(
                    data_jobs.c.job_id == job_id,
                    data_jobs.c.status == "running",
                    data_jobs.c.lease_token == lease_token,
                    data_jobs.c.lease_expires_at > timestamp,
                    data_jobs.c.cancel_requested.is_(False),
                )
                .values(
                    progress=progress,
                    lease_expires_at=timestamp + timedelta(seconds=lease_seconds),
                    updated_at=timestamp,
                )
            )
        return bool(result.rowcount)

    async def complete_data_job(
        self,
        *,
        job_id: str,
        lease_token: str,
        result: dict[str, Any],
        finish_committed_deletion: bool = False,
        now: datetime | None = None,
    ) -> bool:
        """保存小型任务结果；已提交的单项删除可在晚到取消时仍报告真实结果。"""
        if not isinstance(result, dict) or len(_json_bytes(result)) > _DATA_JOB_RESULT_MAX_BYTES:
            raise ValueError("Data job result must be a small JSON object")
        if not isinstance(finish_committed_deletion, bool):
            raise ValueError("finish_committed_deletion must be a boolean")
        if set(result) - _DATA_JOB_RESULT_KEYS:
            raise ValueError("Data job result contains unsupported fields")
        for count_key in (
            "size_bytes",
            "failed_resources_count",
            "deleted_resources_count",
            "remaining_resources_count",
        ):
            count = result.get(count_key)
            if count is not None and (
                isinstance(count, bool) or not isinstance(count, int) or count < 0
            ):
                raise ValueError(f"Invalid data job result field: {count_key}")
        if "artifact_id" in result and (
            not isinstance(result["artifact_id"], str)
            or not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", result["artifact_id"])
        ):
            raise ValueError("Invalid data job artifact id")
        if "sha256" in result and (
            not isinstance(result["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", result["sha256"])
        ):
            raise ValueError("Invalid data job result checksum")
        if "completeness" in result and result["completeness"] not in {"complete", "partial"}:
            raise ValueError("Invalid data job completeness")
        if "expires_at" in result and (
            not isinstance(result["expires_at"], str) or len(result["expires_at"]) > 40
        ):
            raise ValueError("Invalid data job artifact expiry")
        timestamp = now or datetime.now(UTC)
        session_factory = self._require_session_factory()
        async with session_factory() as session, session.begin():
            current = (
                await session.execute(
                    select(
                        data_jobs.c.cancel_requested,
                        data_jobs.c.owner_user_id,
                        data_jobs.c.kind,
                        data_jobs.c.request_id,
                    ).where(
                        data_jobs.c.job_id == job_id,
                        data_jobs.c.status == "running",
                        data_jobs.c.lease_token == lease_token,
                        data_jobs.c.lease_expires_at > timestamp,
                    )
                )
            ).first()
            if current is None:
                return False
            if finish_committed_deletion and current.kind != "deletion":
                raise ValueError("Only committed deletions may finish after cancellation")
            cancelled = current.cancel_requested and not finish_committed_deletion
            updated = await session.execute(
                update(data_jobs)
                .where(
                    data_jobs.c.job_id == job_id,
                    data_jobs.c.status == "running",
                    data_jobs.c.lease_token == lease_token,
                    data_jobs.c.lease_expires_at > timestamp,
                )
                .values(
                    status="cancelled" if cancelled else "completed",
                    result=None if cancelled else result,
                    error_code="cancelled_by_owner" if cancelled else None,
                    lease_owner=None,
                    lease_token=None,
                    lease_expires_at=None,
                    updated_at=timestamp,
                )
            )
            if updated.rowcount and not cancelled:
                await session.execute(
                    insert(audit_events).values(
                        event_id=str(uuid4()),
                        actor_user_id=current.owner_user_id,
                        action=f"data.{current.kind}.completed",
                        resource_type="data_job",
                        resource_id=job_id,
                        outcome="success",
                        occurred_at=timestamp,
                        request_id=current.request_id,
                    )
                )
            elif updated.rowcount:
                await session.execute(
                    insert(audit_events).values(
                        event_id=str(uuid4()),
                        actor_user_id=current.owner_user_id,
                        action=f"data.{current.kind}.cancelled",
                        resource_type="data_job",
                        resource_id=job_id,
                        outcome="cancelled",
                        occurred_at=timestamp,
                        request_id=current.request_id,
                    )
                )
        return bool(updated.rowcount)

    async def fail_data_job(
        self,
        *,
        job_id: str,
        lease_token: str,
        error_code: str,
        retry_after_seconds: int | None,
        now: datetime | None = None,
    ) -> bool:
        """保留稳定错误码并按次数决定等待重试、最终失败或用户取消。"""
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", error_code):
            raise ValueError("Invalid data job error code")
        if retry_after_seconds is not None and not 0 <= retry_after_seconds <= 86_400:
            raise ValueError("retry_after_seconds must be between 0 and 86400")
        timestamp = now or datetime.now(UTC)
        session_factory = self._require_session_factory()
        async with session_factory() as session, session.begin():
            current = (
                await session.execute(
                    select(
                        data_jobs.c.attempt,
                        data_jobs.c.max_attempts,
                        data_jobs.c.cancel_requested,
                        data_jobs.c.owner_user_id,
                        data_jobs.c.kind,
                        data_jobs.c.request_id,
                    ).where(
                        data_jobs.c.job_id == job_id,
                        data_jobs.c.status == "running",
                        data_jobs.c.lease_token == lease_token,
                        data_jobs.c.lease_expires_at > timestamp,
                    )
                )
            ).first()
            if current is None:
                return False
            if current.cancel_requested:
                next_status = "cancelled"
                next_error = "cancelled_by_owner"
                available_at = timestamp
            elif retry_after_seconds is not None and current.attempt < current.max_attempts:
                next_status = "retry_wait"
                next_error = error_code
                available_at = timestamp + timedelta(seconds=retry_after_seconds)
            else:
                next_status = "failed"
                next_error = error_code
                available_at = timestamp
            updated = await session.execute(
                update(data_jobs)
                .where(
                    data_jobs.c.job_id == job_id,
                    data_jobs.c.status == "running",
                    data_jobs.c.lease_token == lease_token,
                    data_jobs.c.lease_expires_at > timestamp,
                )
                .values(
                    status=next_status,
                    error_code=next_error,
                    available_at=available_at,
                    lease_owner=None,
                    lease_token=None,
                    lease_expires_at=None,
                    updated_at=timestamp,
                )
            )
            if updated.rowcount and next_status in {"failed", "cancelled"}:
                # 终态审计只包含稳定结果码，不写入异常正文或可能带敏感信息的堆栈。
                await session.execute(
                    insert(audit_events).values(
                        event_id=str(uuid4()),
                        actor_user_id=current.owner_user_id,
                        action=f"data.{current.kind}.{next_status}",
                        resource_type="data_job",
                        resource_id=job_id,
                        outcome="failure" if next_status == "failed" else "cancelled",
                        occurred_at=timestamp,
                        request_id=current.request_id,
                    )
                )
        return bool(updated.rowcount)

    async def request_data_job_cancel(
        self,
        owner_user_id: str,
        job_id: str,
        *,
        request_id: str | None = None,
        now: datetime | None = None,
    ) -> bool:
        """排队任务立即取消；运行任务只发取消请求，由 worker 在安全点确认。"""
        session_factory = self._require_session_factory()
        timestamp = now or datetime.now(UTC)
        async with session_factory() as session, session.begin():
            row = (
                await session.execute(
                    select(
                        data_jobs.c.status,
                        data_jobs.c.kind,
                        data_jobs.c.request_id,
                    ).where(
                        data_jobs.c.job_id == job_id,
                        data_jobs.c.owner_user_id == owner_user_id,
                    )
                )
            ).first()
            if row is None or row.status in _DATA_JOB_TERMINAL:
                return False
            terminal = row.status in {"queued", "retry_wait"}
            updated = await session.execute(
                update(data_jobs)
                .where(
                    data_jobs.c.job_id == job_id,
                    data_jobs.c.owner_user_id == owner_user_id,
                    data_jobs.c.status == row.status,
                )
                .values(
                    status="cancelled" if terminal else "running",
                    cancel_requested=True,
                    error_code="cancelled_by_owner" if terminal else None,
                    lease_owner=None if terminal else data_jobs.c.lease_owner,
                    lease_token=None if terminal else data_jobs.c.lease_token,
                    lease_expires_at=None if terminal else data_jobs.c.lease_expires_at,
                    updated_at=timestamp,
                )
            )
            if not updated.rowcount:
                return False
            await session.execute(
                insert(audit_events).values(
                    event_id=str(uuid4()),
                    actor_user_id=owner_user_id,
                    action=f"data.{row.kind}.cancel_requested",
                    resource_type="data_job",
                    resource_id=job_id,
                    outcome="success",
                    occurred_at=timestamp,
                    request_id=request_id or row.request_id,
                )
            )
            if terminal:
                await session.execute(
                    insert(audit_events).values(
                        event_id=str(uuid4()),
                        actor_user_id=owner_user_id,
                        action=f"data.{row.kind}.cancelled",
                        resource_type="data_job",
                        resource_id=job_id,
                        outcome="cancelled",
                        occurred_at=timestamp,
                        request_id=request_id or row.request_id,
                    )
                )
        return True

    async def list_for_user(self, user_id: str) -> list[dict[str, Any]]:
        session_factory = self._require_session_factory()
        async with session_factory() as session:
            rows = (
                await session.execute(
                    select(user_settings.c.setting_key, user_settings.c.value)
                    .where(user_settings.c.user_id == user_id)
                    .order_by(user_settings.c.setting_key)
                )
            ).all()
        return [{"key": key, "value": value} for key, value in rows]

    async def put_for_user(
        self,
        user_id: str,
        key: str,
        value: Any,
        request_id: str | None = None,
    ) -> None:
        session_factory = self._require_session_factory()
        encoded_size = len(_json_bytes(value))
        if encoded_size > _MAX_SETTING_BYTES:
            raise ValueError(f"Setting value exceeds {_MAX_SETTING_BYTES} bytes")

        now = datetime.now(UTC)
        async with session_factory() as session:
            dialect = session.bind.dialect.name if session.bind is not None else ""
            if dialect == "postgresql":
                insert_statement = postgres_insert(user_settings)
            elif dialect == "sqlite":
                insert_statement = sqlite_insert(user_settings)
            else:
                raise RuntimeError(f"Unsupported product settings database: {dialect}")

            statement = insert_statement.values(
                user_id=user_id,
                setting_key=key,
                value=value,
                updated_at=now,
            )
            statement = statement.on_conflict_do_update(
                index_elements=[user_settings.c.user_id, user_settings.c.setting_key],
                set_={"value": value, "updated_at": now},
            )
            async with session.begin():
                await session.execute(statement)
                await session.execute(
                    insert(audit_events).values(
                        event_id=str(uuid4()),
                        actor_user_id=user_id,
                        action="settings.write",
                        resource_type="user_setting",
                        resource_id=key,
                        outcome="success",
                        occurred_at=now,
                        request_id=request_id,
                    )
                )

    async def delete_for_user(
        self,
        user_id: str,
        key: str,
        request_id: str | None = None,
    ) -> bool:
        session_factory = self._require_session_factory()
        async with session_factory() as session, session.begin():
            result = await session.execute(
                delete(user_settings).where(
                    user_settings.c.user_id == user_id,
                    user_settings.c.setting_key == key,
                )
            )
            deleted = result.rowcount > 0
            await session.execute(
                insert(audit_events).values(
                    event_id=str(uuid4()),
                    actor_user_id=user_id,
                    action="settings.delete",
                    resource_type="user_setting",
                    resource_id=key,
                    outcome="success" if deleted else "not_found",
                    occurred_at=datetime.now(UTC),
                    request_id=request_id,
                )
            )
        return deleted

    async def list_audit_events(self, limit: int, offset: int) -> list[dict[str, Any]]:
        """返回管理端分页数据；调用方必须先通过宿主的管理员授权检查。"""
        session_factory = self._require_session_factory()
        async with session_factory() as session:
            rows = (
                (
                    await session.execute(
                        select(
                            audit_events.c.event_id,
                            audit_events.c.actor_user_id,
                            audit_events.c.action,
                            audit_events.c.resource_type,
                            audit_events.c.resource_id,
                            audit_events.c.outcome,
                            audit_events.c.occurred_at,
                            audit_events.c.request_id,
                        )
                        .order_by(audit_events.c.occurred_at.desc(), audit_events.c.event_id.desc())
                        .limit(limit)
                        .offset(offset)
                    )
                )
                .mappings()
                .all()
            )
        return [dict(row) for row in rows]

    async def on_admin_action(self, event: AdminActionEvent) -> None:
        """Persist bounded Gateway action metadata in the product-owned audit table."""
        session_factory = self._require_session_factory()
        bounded_fields = (
            (event.actor_user_id, 255, "actor_user_id"),
            (event.action, 100, "action"),
            (event.resource_type, 100, "resource_type"),
            (event.resource_id or "", 255, "resource_id"),
            (event.request_id or "", 128, "request_id"),
        )
        for value, maximum, field_name in bounded_fields:
            if len(value) > maximum:
                raise ValueError(f"Admin audit {field_name} exceeds {maximum} characters")

        async with session_factory() as session, session.begin():
            await session.execute(
                insert(audit_events).values(
                    event_id=str(uuid4()),
                    actor_user_id=event.actor_user_id,
                    action=event.action,
                    resource_type=event.resource_type,
                    resource_id=event.resource_id or "",
                    outcome=event.outcome,
                    occurred_at=event.occurred_at,
                    request_id=event.request_id,
                )
            )

    async def read_product_config(self) -> dict[str, Any]:
        """读取在线配置覆盖；没有覆盖时由 API 使用部署模板默认值。"""
        session_factory = self._require_session_factory()
        async with session_factory() as session:
            row = (
                await session.execute(
                    select(product_settings.c.value, product_settings.c.config_version).where(
                        product_settings.c.setting_key == _PRODUCT_CONFIG_KEY
                    )
                )
            ).first()
        if row is None:
            return {"config": {}, "version": 0}
        config = row.value if isinstance(row.value, dict) else {}
        return {"config": config, "version": row.config_version}

    async def patch_product_config(
        self,
        patch: dict[str, Any],
        expected_version: int,
        actor_user_id: str,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        """以乐观锁更新部署级展示配置，配置变更与审计原子提交。"""
        session_factory = self._require_session_factory()
        if len(_json_bytes(patch)) > 16 * 1024:
            raise ValueError("Product config patch exceeds the 16 KiB limit")

        now = datetime.now(UTC)
        async with session_factory() as session:
            dialect = session.bind.dialect.name if session.bind is not None else ""
            if dialect == "postgresql":
                insert_statement = postgres_insert(product_settings)
            elif dialect == "sqlite":
                insert_statement = sqlite_insert(product_settings)
            else:
                raise RuntimeError(f"Unsupported product settings database: {dialect}")

            values = {
                "value": patch,
                "config_version": expected_version + 1,
                "updated_by": actor_user_id,
                "updated_at": now,
            }
            if expected_version == 0:
                # 首次保存允许插入 v1；若另一进程先插入，则只有 v0 记录可覆盖，
                # 因此旧页面不会覆盖已经保存的新配置。
                statement = insert_statement.values(
                    setting_key=_PRODUCT_CONFIG_KEY,
                    **values,
                ).on_conflict_do_update(
                    index_elements=[product_settings.c.setting_key],
                    set_=values,
                    where=product_settings.c.config_version == 0,
                )
            else:
                # 非零版本必须更新现存版本行，不能在数据库被重置后误插入高版本。
                statement = (
                    update(product_settings)
                    .where(
                        product_settings.c.setting_key == _PRODUCT_CONFIG_KEY,
                        product_settings.c.config_version == expected_version,
                    )
                    .values(**values)
                )
            async with session.begin():
                result = await session.execute(statement)
                row = (
                    await session.execute(
                        select(product_settings.c.value, product_settings.c.config_version).where(
                            product_settings.c.setting_key == _PRODUCT_CONFIG_KEY
                        )
                    )
                ).one_or_none()
                if row is None and result.rowcount == 0 and expected_version > 0:
                    # 数据库被回滚/重置后，旧页面的非零版本应收到冲突，
                    # 而不是在缺行状态下插入一个凭空跳号的配置版本。
                    current = {"config": {}, "version": 0}
                elif row is None:
                    raise RuntimeError("Product config upsert did not create a row")
                elif result.rowcount == 0:
                    current = {
                        "config": row.value if isinstance(row.value, dict) else {},
                        "version": row.config_version,
                    }
                else:
                    await session.execute(
                        insert(audit_events).values(
                            event_id=str(uuid4()),
                            actor_user_id=actor_user_id,
                            action="product.settings.patch",
                            resource_type="product_config",
                            resource_id=_PRODUCT_CONFIG_KEY,
                            outcome="success",
                            occurred_at=now,
                            request_id=request_id,
                        )
                    )
                    current = {"config": patch, "version": row.config_version}

        if result.rowcount == 0:
            raise ProductConfigVersionConflict(current["version"])
        return current

    async def list_owner_files(
        self,
        owner_user_id: str,
        *,
        limit: int,
        offset: int,
        query: str = "",
        refresh: bool = False,
    ) -> CachedOwnerFilePage | None:
        """读取自有数据库里的 owner 快照，过期时通过 Gateway reader 有界重建。"""
        if not owner_user_id or len(owner_user_id) > 255:
            raise ValueError("Invalid file catalog owner")
        if not 1 <= limit <= _FILE_CATALOG_LIMIT:
            raise ValueError(f"File catalog limit must be between 1 and {_FILE_CATALOG_LIMIT}")
        if not 0 <= offset <= 1_000_000:
            raise ValueError("File catalog offset must be between 0 and 1000000")
        if not isinstance(query, str) or len(query) > 200:
            raise ValueError("File catalog query must be at most 200 characters")

        refresh_token, refresh_deferred = await self._claim_file_catalog_refresh(
            owner_user_id,
            force=refresh,
        )
        if refresh_token is not None:
            reader = self._owner_data_reader
            list_files = getattr(reader, "list_files", None)
            try:
                if not callable(list_files):
                    raise RuntimeError("Owner file catalog reader is unavailable")
                # 扩展只请求一次 Gateway 有界目录；搜索和小页翻页由产品数据库完成。
                host_page = await list_files(
                    user_id=owner_user_id,
                    limit=_FILE_CATALOG_LIMIT,
                    offset=0,
                    query="",
                )
                if host_page is None:
                    raise RuntimeError("Owner file catalog reader is unavailable")
                await self._publish_file_catalog_snapshot(
                    owner_user_id,
                    refresh_token,
                    host_page,
                )
            except Exception:
                # reader 或目录扫描失败时保留旧快照；异常正文可能含宿主细节，不返回浏览器。
                await self._fail_file_catalog_refresh(owner_user_id, refresh_token)

        return await self._read_owner_file_catalog_page(
            owner_user_id,
            limit=limit,
            offset=offset,
            query=query,
            refresh_deferred=refresh_deferred,
        )

    async def invalidate_owner_file_catalog_entry(
        self,
        owner_user_id: str,
        file_id: str,
    ) -> bool:
        """删除已由 Gateway 成功删除资源的缓存行，并让快照进入待刷新状态。"""
        if not owner_user_id or len(owner_user_id) > 255:
            raise ValueError("Invalid file catalog owner")
        if not isinstance(file_id, str) or not file_id or len(file_id) > 8192:
            raise ValueError("Invalid file catalog ID")

        now = datetime.now(UTC)
        session_factory = self._require_session_factory()
        async with session_factory() as session, session.begin():
            state = (
                (
                    await session.execute(
                        select(file_catalog_state)
                        .where(file_catalog_state.c.owner_user_id == owner_user_id)
                        .with_for_update()
                    )
                )
                .mappings()
                .one_or_none()
            )
            if state is None or not state["snapshot_id"]:
                return False
            deleted = await session.execute(
                delete(file_catalog_entries).where(
                    file_catalog_entries.c.owner_user_id == owner_user_id,
                    file_catalog_entries.c.snapshot_id == state["snapshot_id"],
                    file_catalog_entries.c.file_id == file_id,
                )
            )
            if not deleted.rowcount:
                return False
            # 文件中心会立即从页面移除此行；下次服务器读取把剩余清单标为陈旧，
            # 冷却到期后再由 Gateway reader 重新发现新增或替代文件。
            await session.execute(
                update(file_catalog_state)
                .where(file_catalog_state.c.owner_user_id == owner_user_id)
                .values(indexed_at=now - _FILE_CATALOG_TTL)
            )
            return True

    async def _claim_file_catalog_refresh(
        self,
        owner_user_id: str,
        *,
        force: bool,
    ) -> tuple[str | None, bool]:
        """用状态行锁跨 Gateway 实例领取刷新租约，避免重复扫描同一用户目录。"""
        session_factory = self._require_session_factory()
        bind = getattr(session_factory, "kw", {}).get("bind")
        if bind is None:
            raise RuntimeError("Flow Desk file catalog storage is not ready")
        now = datetime.now(UTC)
        state_values = {
            "owner_user_id": owner_user_id,
            "snapshot_id": None,
            "indexed_at": None,
            "last_attempt_at": None,
            "refresh_token": None,
            "refresh_lease_expires_at": None,
            "refresh_failed": False,
            "truncated": False,
            "failed_count": 0,
            "coverage_notes": [],
        }
        insert_factory = postgres_insert if bind.dialect.name == "postgresql" else sqlite_insert
        async with session_factory() as session, session.begin():
            await session.execute(
                insert_factory(file_catalog_state)
                .values(**state_values)
                .on_conflict_do_nothing(index_elements=[file_catalog_state.c.owner_user_id])
            )
            row = (
                (
                    await session.execute(
                        select(file_catalog_state)
                        .where(file_catalog_state.c.owner_user_id == owner_user_id)
                        .with_for_update()
                    )
                )
                .mappings()
                .one()
            )
            indexed_at = _as_utc_datetime(row["indexed_at"])
            last_attempt_at = _as_utc_datetime(row["last_attempt_at"])
            lease_expires_at = _as_utc_datetime(row["refresh_lease_expires_at"])
            stale = indexed_at is None or now - indexed_at >= _FILE_CATALOG_TTL
            refresh_in_progress = (
                bool(row["refresh_token"])
                and lease_expires_at is not None
                and lease_expires_at > now
            )
            within_refresh_interval = (
                last_attempt_at is not None
                and now - last_attempt_at < _FILE_CATALOG_REFRESH_INTERVAL
            )
            if not (force or stale):
                return None, False
            # 手动刷新也遵守 30 秒间隔，避免反复触发有界但较重的 Gateway 扫描。
            # 告诉界面本次请求被延后，避免用户以为快照已经更新。
            if refresh_in_progress or within_refresh_interval:
                return None, force

            token = str(uuid4())
            await session.execute(
                update(file_catalog_state)
                .where(file_catalog_state.c.owner_user_id == owner_user_id)
                .values(
                    last_attempt_at=now,
                    refresh_token=token,
                    refresh_lease_expires_at=now + _FILE_CATALOG_REFRESH_LEASE,
                )
            )
            return token, False

    async def _publish_file_catalog_snapshot(
        self,
        owner_user_id: str,
        refresh_token: str,
        host_page: OwnerFilePage,
    ) -> None:
        """完整写入新快照后再切换状态指针，避免失败刷新破坏旧目录。"""
        source_files = getattr(host_page, "files", None)
        if not isinstance(source_files, Sequence) or isinstance(
            source_files,
            str | bytes | bytearray,
        ):
            raise ValueError("Gateway returned an invalid file catalog")
        source_truncated = bool(
            getattr(host_page, "truncated", False)
            or getattr(host_page, "has_more", False)
            or getattr(host_page, "next_offset", None) is not None
        )
        entries: dict[str, dict[str, Any]] = {}
        invalid_count = 0
        for file in source_files[:_FILE_CATALOG_LIMIT]:
            try:
                value = _file_catalog_entry_values(file)
            except (TypeError, ValueError):
                invalid_count += 1
                continue
            entries[value["entry_hash"]] = value
        if len(source_files) > _FILE_CATALOG_LIMIT:
            source_truncated = True

        source_notes = getattr(host_page, "coverage_notes", ())
        if isinstance(source_notes, Sequence) and not isinstance(
            source_notes,
            str | bytes | bytearray,
        ):
            coverage_notes = [
                note[:500] for note in source_notes[:32] if isinstance(note, str) and note.strip()
            ]
        else:
            coverage_notes = []
        if invalid_count:
            coverage_notes.append("Some invalid file metadata entries were omitted.")
        raw_failed_count = getattr(host_page, "failed_count", 0)
        failed_count = (
            raw_failed_count
            if isinstance(raw_failed_count, int) and not isinstance(raw_failed_count, bool)
            else 0
        )
        failed_count = max(0, failed_count) + invalid_count
        snapshot_id = str(uuid4())
        now = datetime.now(UTC)
        session_factory = self._require_session_factory()
        async with session_factory() as session, session.begin():
            state = (
                (
                    await session.execute(
                        select(file_catalog_state)
                        .where(file_catalog_state.c.owner_user_id == owner_user_id)
                        .with_for_update()
                    )
                )
                .mappings()
                .one_or_none()
            )
            # 租约已被另一实例接管时，丢弃旧扫描结果，不覆盖更新后的目录。
            if state is None or state["refresh_token"] != refresh_token:
                return
            values = [
                {
                    **entry,
                    "owner_user_id": owner_user_id,
                    "snapshot_id": snapshot_id,
                }
                for entry in entries.values()
            ]
            for start in range(0, len(values), _FILE_CATALOG_INSERT_BATCH):
                await session.execute(
                    insert(file_catalog_entries),
                    values[start : start + _FILE_CATALOG_INSERT_BATCH],
                )
            await session.execute(
                update(file_catalog_state)
                .where(file_catalog_state.c.owner_user_id == owner_user_id)
                .values(
                    snapshot_id=snapshot_id,
                    indexed_at=now,
                    refresh_token=None,
                    refresh_lease_expires_at=None,
                    refresh_failed=False,
                    truncated=source_truncated,
                    failed_count=failed_count,
                    coverage_notes=coverage_notes,
                )
            )
            await session.execute(
                delete(file_catalog_entries).where(
                    file_catalog_entries.c.owner_user_id == owner_user_id,
                    file_catalog_entries.c.snapshot_id != snapshot_id,
                )
            )

    async def _fail_file_catalog_refresh(self, owner_user_id: str, refresh_token: str) -> None:
        """清除失败租约但保留旧快照，冷却后可再次刷新。"""
        session_factory = self._require_session_factory()
        async with session_factory() as session, session.begin():
            await session.execute(
                update(file_catalog_state)
                .where(
                    file_catalog_state.c.owner_user_id == owner_user_id,
                    file_catalog_state.c.refresh_token == refresh_token,
                )
                .values(
                    refresh_token=None,
                    refresh_lease_expires_at=None,
                    refresh_failed=True,
                )
            )

    async def _read_owner_file_catalog_page(
        self,
        owner_user_id: str,
        *,
        limit: int,
        offset: int,
        query: str,
        refresh_deferred: bool,
    ) -> CachedOwnerFilePage | None:
        """始终以 principal owner 和活动快照 ID 双重限制目录读取。"""
        session_factory = self._require_session_factory()
        async with session_factory() as session:
            state = (
                (
                    await session.execute(
                        select(file_catalog_state).where(
                            file_catalog_state.c.owner_user_id == owner_user_id
                        )
                    )
                )
                .mappings()
                .one_or_none()
            )
            if state is None or not state["snapshot_id"]:
                return None
            indexed_at = _as_utc_datetime(state["indexed_at"])
            catalog_stale = (
                indexed_at is None
                or datetime.now(UTC) - indexed_at >= _FILE_CATALOG_TTL
                or bool(state["refresh_failed"])
            )
            rows = (
                (
                    await session.execute(
                        select(file_catalog_entries).where(
                            file_catalog_entries.c.owner_user_id == owner_user_id,
                            file_catalog_entries.c.snapshot_id == state["snapshot_id"],
                        )
                    )
                )
                .mappings()
                .all()
            )

        entries = [
            OwnerFileEntry(
                file_id=row["file_id"],
                source=row["source"],
                name=row["name"],
                size_bytes=row["size_bytes"],
                artifact_url=row["artifact_url"],
                modified_at=row["modified_at"],
                storage_name=row["storage_name"],
                thread_id=row["thread_id"],
                thread_name=row["thread_name"],
                project_id=row["project_id"],
                project_name=row["project_name"],
                document_id=row["document_id"],
            )
            for row in rows
        ]
        needle = query.strip().casefold()
        if needle:
            entries = [
                entry
                for entry in entries
                if needle
                in " ".join(
                    part for part in (entry.name, entry.thread_name, entry.project_name) if part
                ).casefold()
            ]
        entries.sort(
            key=lambda entry: (
                -(entry.modified_at or 0),
                entry.name.casefold(),
                entry.source,
                entry.file_id,
            )
        )
        total = len(entries)
        files = tuple(entries[offset : offset + limit])
        coverage_notes = (
            tuple(note for note in state["coverage_notes"] if isinstance(note, str))
            if isinstance(state["coverage_notes"], (tuple, list))
            else ()
        )
        if catalog_stale:
            stale_note = (
                _FILE_CATALOG_REFRESH_FAILED_NOTE
                if state["refresh_failed"]
                else _FILE_CATALOG_STALE_NOTE
            )
            coverage_notes = (*coverage_notes, stale_note)
        has_more = offset + len(files) < total
        return CachedOwnerFilePage(
            files=files,
            total=total,
            has_more=has_more,
            next_offset=offset + len(files) if has_more else None,
            truncated=bool(state["truncated"]),
            failed_count=state["failed_count"],
            coverage_notes=coverage_notes,
            catalog_updated_at=indexed_at,
            catalog_stale=catalog_stale,
            catalog_refresh_deferred=refresh_deferred,
        )

    @staticmethod
    def _public_data_job(row: Any) -> dict[str, Any]:
        """过滤幂等键与 worker 租约，只返回账号页可展示的任务字段。"""
        return {
            "job_id": row["job_id"],
            "kind": row["kind"],
            "scope": row["scope"],
            "status": row["status"],
            "progress": row["progress"],
            "result": row["result"],
            "error_code": row["error_code"],
            "attempt": row["attempt"],
            "max_attempts": row["max_attempts"],
            "cancel_requested": row["cancel_requested"],
            "request_id": row["request_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _require_session_factory(self) -> async_sessionmaker[AsyncSession]:
        if self._session_factory is None:
            raise RuntimeError("Flow Desk settings storage is not ready")
        return self._session_factory

    async def _upgrade_schema(self, engine: Any) -> None:
        """在 Gateway schema 完成后升级独立 Alembic chain。

        PostgreSQL 用 advisory lock 防止多实例同时迁移；SQLite 在事务开始时
        立即取得写锁。迁移只运行本扩展 package 内的脚本，不导入 Gateway 私有模块。
        """
        dialect = engine.dialect.name
        if dialect not in {"postgresql", "sqlite"}:
            raise RuntimeError(f"Unsupported product settings database: {dialect}")
        if dialect == "sqlite":
            # 同一套迁移脚本在 SQLite 上复用逻辑 schema 名，不污染模型定义。
            engine = engine.execution_options(schema_translate_map={"product": None})

        async with engine.connect() as connection:
            if dialect == "postgresql":
                await connection.execute(
                    text("SELECT pg_advisory_lock(:lock_id)"),
                    {"lock_id": _POSTGRES_MIGRATION_LOCK},
                )
                # Alembic 的独立版本表本身也落在自有 schema；先创建 schema，
                # 否则 runner 无法在执行 fd_0001 前记录当前 revision。
                await connection.execute(text("CREATE SCHEMA IF NOT EXISTS product"))
                await connection.commit()
            else:
                # SQLite 的 deferred transaction 会在首个写入时才抢锁；
                # 先 BEGIN IMMEDIATE，避免两个 Gateway 同时读到旧版本再插入重复版本。
                await connection.exec_driver_sql("BEGIN IMMEDIATE")

            try:
                await connection.run_sync(_run_alembic_upgrade)
                if connection.in_transaction():
                    await connection.commit()
            except BaseException:
                if connection.in_transaction():
                    await connection.rollback()
                raise
            finally:
                if dialect == "postgresql":
                    if connection.in_transaction():
                        await connection.rollback()
                    await connection.execute(
                        text("SELECT pg_advisory_unlock(:lock_id)"),
                        {"lock_id": _POSTGRES_MIGRATION_LOCK},
                    )
                    await connection.commit()


def _run_alembic_upgrade(connection: Any) -> None:
    """在现有同步连接上执行扩展迁移，避免再建第二个连接池。"""
    from importlib.resources import files

    migration_dir = Path(str(files("flow_desk_product_extension").joinpath("migrations")))
    config = Config()
    config.set_main_option("script_location", str(migration_dir))
    config.attributes["connection"] = connection
    command.upgrade(config, "head")


def _as_utc_datetime(value: Any) -> datetime | None:
    """SQLite 丢失时区标记；读出时按 UTC 解释，避免 TTL 比较跨环境出错。"""
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _file_catalog_entry_values(file: Any) -> dict[str, Any]:
    """验证并投影 Gateway 文件 DTO 的元数据白名单，不接受内容或宿主路径。"""
    file_id = getattr(file, "file_id", None)
    source = getattr(file, "source", None)
    name = getattr(file, "name", None)
    size_bytes = getattr(file, "size_bytes", None)
    artifact_url = getattr(file, "artifact_url", None)
    if not isinstance(file_id, str) or not file_id or len(file_id) > 8192 or "\x00" in file_id:
        raise ValueError("Invalid file catalog ID")
    if source not in _FILE_CATALOG_SOURCES:
        raise ValueError("Unsupported file catalog source")
    if not isinstance(name, str) or not name or len(name) > 8192 or "\x00" in name:
        raise ValueError("Invalid file catalog name")
    if not isinstance(size_bytes, int) or isinstance(size_bytes, bool) or size_bytes < 0:
        raise ValueError("Invalid file catalog size")
    if (
        not isinstance(artifact_url, str)
        or not artifact_url.startswith("/api/")
        or "\r" in artifact_url
        or "\n" in artifact_url
        or "\x00" in artifact_url
        or len(artifact_url) > 16_384
    ):
        raise ValueError("Invalid owner-checked artifact URL")

    modified_at = getattr(file, "modified_at", None)
    if modified_at is not None:
        if (
            not isinstance(modified_at, int | float)
            or isinstance(modified_at, bool)
            or not math.isfinite(modified_at)
        ):
            raise ValueError("Invalid file catalog timestamp")
        modified_at = float(modified_at)

    optional_fields: dict[str, str | None] = {}
    for field in (
        "storage_name",
        "thread_id",
        "thread_name",
        "project_id",
        "project_name",
        "document_id",
    ):
        value = getattr(file, field, None)
        if value is not None and (
            not isinstance(value, str) or len(value) > 8192 or "\x00" in value
        ):
            raise ValueError(f"Invalid file catalog {field}")
        optional_fields[field] = value
    # Only uploads expose a delete basename; shelf and workspace paths remain private.
    if source != "thread_upload":
        optional_fields["storage_name"] = None
    return {
        "entry_hash": hashlib.sha256(f"{source}\0{file_id}".encode()).hexdigest(),
        "file_id": file_id,
        "source": source,
        "name": name,
        "size_bytes": size_bytes,
        "artifact_url": artifact_url,
        "modified_at": modified_at,
        **optional_fields,
    }


def _json_bytes(value: Any) -> bytes:
    """用 JSON 可编码性校验保证数据库 JSON 列只接收标准 JSON 值。"""
    import json

    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("Setting value must be valid JSON") from exc
