from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from deerflow.persistence.base import Base
from deerflow.persistence.iam_model_usage_outbox import (
    IamModelUsageOutboxService,
    IamModelUsageOutboxStore,
)
from deerflow.persistence.models.iam_model_usage_outbox import IamModelUsageOutboxRow


class _FakeClient:
    def __init__(self, *, fail_once: bool = False) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.fail_once = fail_once

    def settle_usage(self, **payload):
        self.calls.append(("settle", payload))
        if self.fail_once:
            self.fail_once = False
            raise RuntimeError("transport detail must not be persisted")

    def report_usage(self, **payload):
        self.calls.append(("report", payload))
        if self.fail_once:
            self.fail_once = False
            raise RuntimeError("transport detail must not be persisted")


@pytest.fixture
def outbox():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    try:
        yield IamModelUsageOutboxStore(sessionmaker(engine, expire_on_commit=False))
    finally:
        engine.dispose()


def _payload(*, action: str = "settle", request_id: str | None = None) -> dict:
    return {
        "request_id": request_id or f"deerflow:llm:{uuid4().hex}",
        "tenant_id": str(uuid4()),
        "model_id": str(uuid4()),
        "application_id": str(uuid4()),
        "user_id": str(uuid4()),
        "action": action,
        "reserved_input_tokens": 12,
        "reserved_output_tokens": 64,
        "input_tokens": 15,
        "output_tokens": 7,
        "outcome": "succeeded",
        "usage_is_estimated": False,
        "latency_ms": 129,
    }


def _row(outbox, request_id):
    with outbox._Session() as session:
        return session.scalar(select(IamModelUsageOutboxRow).where(IamModelUsageOutboxRow.request_id == request_id))


def test_settlement_is_persisted_and_delivered_once(outbox) -> None:
    client = _FakeClient()
    payload = _payload()
    assert outbox.enqueue(**payload) is True
    assert outbox.dispatch_request(payload["request_id"], client) is True
    assert outbox.dispatch_due(client) == 0
    assert client.calls == [
        (
            "settle",
            {
                "request_id": payload["request_id"],
                "input_tokens": 15,
                "output_tokens": 7,
                "outcome": "succeeded",
                "usage_is_estimated": False,
                "latency_ms": 129,
            },
        )
    ]
    row = _row(outbox, payload["request_id"])
    assert row.status == "delivered"
    assert row.attempt_count == 0


def test_unreserved_usage_report_survives_delivery_failure_and_retries(outbox) -> None:
    client = _FakeClient(fail_once=True)
    payload = _payload(action="report")
    outbox.enqueue(**payload)
    assert outbox.dispatch_request(payload["request_id"], client) is True
    row = _row(outbox, payload["request_id"])
    assert row.status == "pending"
    assert row.attempt_count == 1
    assert row.last_error_class == "RuntimeError"

    with outbox._Session.begin() as session:
        row = session.scalar(select(IamModelUsageOutboxRow).where(IamModelUsageOutboxRow.request_id == payload["request_id"]))
        row.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)

    assert outbox.dispatch_due(client) == 1
    assert _row(outbox, payload["request_id"]).status == "delivered"
    assert [call[0] for call in client.calls] == ["report", "report"]
    assert "transport detail" not in repr(_row(outbox, payload["request_id"]))


def test_expired_processing_lease_is_reclaimed_after_worker_restart(outbox) -> None:
    client = _FakeClient()
    payload = _payload()
    outbox.enqueue(**payload)
    row = _row(outbox, payload["request_id"])
    with outbox._Session.begin() as session:
        row = session.get(IamModelUsageOutboxRow, row.id)
        row.status = "processing"
        row.lease_owner = uuid4()
        row.lease_until = datetime.now(UTC) - timedelta(seconds=1)

    assert outbox.dispatch_due(client) == 1
    assert _row(outbox, payload["request_id"]).status == "delivered"


def test_request_id_cannot_be_reused_with_a_different_usage_payload(outbox) -> None:
    payload = _payload()
    assert outbox.enqueue(**payload) is True
    assert outbox.enqueue(**payload) is False
    changed = dict(payload, output_tokens=payload["output_tokens"] + 1)
    with pytest.raises(ValueError, match="different payload"):
        outbox.enqueue(**changed)


def test_outbox_schema_contains_no_prompt_or_credential_fields() -> None:
    names = set(IamModelUsageOutboxRow.__table__.columns.keys())
    assert not names.intersection({"prompt", "response", "access_token", "refresh_token", "gateway_key"})


@pytest.mark.asyncio
async def test_gateway_worker_retries_persisted_outbox_rows(outbox) -> None:
    client = _FakeClient()
    payload = _payload()
    outbox.enqueue(**payload)
    service = IamModelUsageOutboxService(store=outbox, client=client, poll_seconds=0.01)
    await service.start()
    try:
        for _ in range(100):
            if _row(outbox, payload["request_id"]).status == "delivered":
                break
            await asyncio.sleep(0.01)
        assert _row(outbox, payload["request_id"]).status == "delivered"
    finally:
        await service.stop()


def test_retention_purges_only_old_delivered_rows(outbox) -> None:
    old = _payload()
    outbox.enqueue(**old)
    client = _FakeClient()
    outbox.dispatch_request(old["request_id"], client)
    with outbox._Session.begin() as session:
        row = session.scalar(select(IamModelUsageOutboxRow).where(IamModelUsageOutboxRow.request_id == old["request_id"]))
        row.delivered_at = datetime.now(UTC) - timedelta(days=31)

    assert outbox.purge_delivered(retention_days=30) == 1
    assert _row(outbox, old["request_id"]) is None
