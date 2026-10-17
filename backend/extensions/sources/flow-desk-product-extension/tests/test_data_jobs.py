"""持久化产品数据任务的 owner、幂等与租约状态机回归测试。"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from deerflow_extension_api import ExtensionRuntimeDeps
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from flow_desk_product_extension.settings import (
    DataJobIdempotencyConflict,
    DataJobInProgressConflict,
    DataJobRateLimitError,
    ProductSettingsStore,
)


def test_data_job_is_durable_owner_scoped_and_idempotent(tmp_path) -> None:
    database_path = tmp_path / "flow-desk-data-jobs.sqlite"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path}",
        poolclass=NullPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    store = ProductSettingsStore()

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=session_factory))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="export-request-1",
            scope=["threads", "files"],
            now=datetime(2026, 9, 28, tzinfo=UTC),
        )
        repeated = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="export-request-1",
            scope=["threads", "files"],
            now=datetime(2026, 9, 28, tzinfo=UTC),
        )

        assert repeated["job_id"] == job["job_id"]
        assert await store.get_data_job("user-b", job["job_id"]) is None
        with pytest.raises(DataJobIdempotencyConflict):
            await store.create_data_job(
                owner_user_id="user-a",
                kind="deletion",
                idempotency_key="export-request-1",
                scope=["threads"],
                now=datetime(2026, 9, 28, tzinfo=UTC),
            )

        await store.stop()
        await store.start(ExtensionRuntimeDeps(session_factory=session_factory))
        persisted = await store.get_data_job("user-a", job["job_id"])
        assert persisted is not None
        assert persisted["status"] == "queued"
        assert persisted["scope"] == ["files", "threads"]
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_product_worker_start_requires_gateway_owner_data_authorizer(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flow-desk-worker-auth-required.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()

    async def scenario() -> None:
        with pytest.raises(RuntimeError, match="owner-data authorizer"):
            await store.start(
                ExtensionRuntimeDeps(
                    session_factory=async_sessionmaker(engine),
                    product_data_directory=tmp_path / "persistent-data",
                )
            )
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_each_owner_can_have_only_one_active_data_job(tmp_path) -> None:
    database_path = tmp_path / "flow-desk-data-job-one-active.sqlite"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        first = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="first-active-job",
            scope=["preferences"],
        )
        with pytest.raises(DataJobInProgressConflict):
            await store.create_data_job(
                owner_user_id="user-a",
                kind="deletion",
                idempotency_key="second-active-job",
                scope=["preferences"],
            )

        # 排队任务取消后，数据库 partial unique index 即释放该 owner 的额度。
        assert await store.request_data_job_cancel(
            "user-a",
            first["job_id"],
        )
        terminal_cancel_event = next(
            event
            for event in await store.list_audit_events(limit=20, offset=0)
            if event["action"] == "data.export.cancelled"
            and event["resource_id"] == first["job_id"]
        )
        assert terminal_cancel_event["outcome"] == "cancelled"
        next_job = await store.create_data_job(
            owner_user_id="user-a",
            kind="deletion",
            idempotency_key="second-active-job",
            scope=["preferences"],
        )
        assert next_job["status"] == "queued"
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_data_job_worker_lease_fences_stale_progress_and_completion(tmp_path) -> None:
    database_path = tmp_path / "flow-desk-data-job-leases.sqlite"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path}",
        poolclass=NullPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    store = ProductSettingsStore()
    started_at = datetime(2026, 9, 28, tzinfo=UTC)

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=session_factory))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="export-request-lease",
            scope=["threads"],
            now=started_at,
        )

        first_claim = await store.claim_data_job(
            worker_id="worker-1",
            lease_seconds=30,
            now=started_at,
        )
        assert first_claim is not None
        assert first_claim["job_id"] == job["job_id"]
        assert first_claim["attempt"] == 1
        assert (
            await store.claim_data_job(
                worker_id="worker-2",
                lease_seconds=30,
                now=started_at + timedelta(seconds=1),
            )
            is None
        )

        with pytest.raises(ValueError):
            await store.update_data_job_progress(
                job_id=job["job_id"],
                lease_token=first_claim["lease_token"],
                progress={"stage": "history", "message": "must-not-persist"},
            )
        with pytest.raises(ValueError):
            await store.complete_data_job(
                job_id=job["job_id"],
                lease_token=first_claim["lease_token"],
                result={"artifact_id": "export-123", "message_body": "secret"},
            )

        assert await store.update_data_job_progress(
            job_id=job["job_id"],
            lease_token=first_claim["lease_token"],
            progress={"stage": "history", "completed": 2, "total": 5},
            now=started_at + timedelta(seconds=5),
            lease_seconds=10,
        )
        assert not await store.update_data_job_progress(
            job_id=job["job_id"],
            lease_token=first_claim["lease_token"],
            progress={"stage": "history", "completed": 3, "total": 5},
            now=started_at + timedelta(seconds=16),
        )
        assert not await store.complete_data_job(
            job_id=job["job_id"],
            lease_token=first_claim["lease_token"],
            result={"artifact_id": "too-late"},
            now=started_at + timedelta(seconds=16),
        )
        assert not await store.fail_data_job(
            job_id=job["job_id"],
            lease_token=first_claim["lease_token"],
            error_code="stale_worker_error",
            retry_after_seconds=1,
            now=started_at + timedelta(seconds=16),
        )
        second_claim = await store.claim_data_job(
            worker_id="worker-2",
            lease_seconds=30,
            now=started_at + timedelta(seconds=31),
        )
        assert second_claim is not None
        assert second_claim["attempt"] == 2
        assert second_claim["lease_token"] != first_claim["lease_token"]

        assert not await store.update_data_job_progress(
            job_id=job["job_id"],
            lease_token=first_claim["lease_token"],
            progress={"stage": "files", "completed": 1, "total": 3},
            now=started_at + timedelta(seconds=32),
        )
        assert not await store.complete_data_job(
            job_id=job["job_id"],
            lease_token=first_claim["lease_token"],
            result={"artifact_id": "export-123"},
            now=started_at + timedelta(seconds=33),
        )
        assert await store.complete_data_job(
            job_id=job["job_id"],
            lease_token=second_claim["lease_token"],
            result={"artifact_id": "export-123"},
            now=started_at + timedelta(seconds=34),
        )
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"] == {"artifact_id": "export-123"}
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_data_job_retry_and_cancel_transitions_are_persisted(tmp_path) -> None:
    database_path = tmp_path / "flow-desk-data-job-retry.sqlite"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path}",
        poolclass=NullPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    store = ProductSettingsStore()
    started_at = datetime(2026, 9, 28, tzinfo=UTC)

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=session_factory))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="deletion",
            idempotency_key="delete-request-1",
            scope=["threads"],
            request_id="request-delete-1",
            max_attempts=2,
            now=started_at,
        )
        first_claim = await store.claim_data_job(
            worker_id="worker-1",
            lease_seconds=30,
            now=started_at,
        )
        assert first_claim is not None

        assert await store.fail_data_job(
            job_id=job["job_id"],
            lease_token=first_claim["lease_token"],
            error_code="temporary_storage_error",
            retry_after_seconds=10,
            now=started_at + timedelta(seconds=1),
        )
        retrying = await store.get_data_job("user-a", job["job_id"])
        assert retrying is not None
        assert retrying["status"] == "retry_wait"
        assert retrying["attempt"] == 1
        assert (
            await store.claim_data_job(
                worker_id="worker-2",
                lease_seconds=30,
                now=started_at + timedelta(seconds=5),
            )
            is None
        )

        second_claim = await store.claim_data_job(
            worker_id="worker-2",
            lease_seconds=30,
            now=started_at + timedelta(seconds=11),
        )
        assert second_claim is not None
        assert second_claim["attempt"] == 2
        assert await store.request_data_job_cancel(
            "user-a",
            job["job_id"],
            now=started_at + timedelta(seconds=11, milliseconds=500),
        )
        cancel_requested = await store.get_data_job("user-a", job["job_id"])
        assert cancel_requested is not None
        assert cancel_requested["status"] == "running"
        assert cancel_requested["cancel_requested"] is True
        control = await store.get_data_job_control(
            job["job_id"],
            second_claim["lease_token"],
            now=started_at + timedelta(seconds=12),
        )
        assert control is not None
        assert control["cancel_requested"] is True
        assert (
            await store.get_data_job_control(
                job["job_id"],
                first_claim["lease_token"],
                now=started_at + timedelta(seconds=12),
            )
            is None
        )

        assert await store.fail_data_job(
            job_id=job["job_id"],
            lease_token=second_claim["lease_token"],
            error_code="cancelled_by_owner",
            retry_after_seconds=10,
            now=started_at + timedelta(seconds=12),
        )
        cancelled = await store.get_data_job("user-a", job["job_id"])
        assert cancelled is not None
        assert cancelled["status"] == "cancelled"
        events = await store.list_audit_events(limit=20, offset=0)
        cancelled_event = next(
            event
            for event in events
            if event["action"] == "data.deletion.cancelled"
            and event["resource_id"] == job["job_id"]
        )
        assert cancelled_event["actor_user_id"] == "user-a"
        assert cancelled_event["outcome"] == "cancelled"
        assert cancelled_event["request_id"] == "request-delete-1"
        assert not any("temporary_storage_error" in str(event) for event in events)
        assert not await store.request_data_job_cancel(
            "user-b", job["job_id"], now=started_at + timedelta(seconds=13)
        )
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_terminal_data_job_failure_is_audited_once_without_error_text(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flow-desk-data-job-failure-audit.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    now = datetime(2026, 9, 28, tzinfo=UTC)

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="failed-export-audit",
            scope=["preferences"],
            request_id="request-export-1",
            max_attempts=1,
            now=now,
        )
        claim = await store.claim_data_job(worker_id="worker-1", lease_seconds=30, now=now)
        assert claim is not None
        assert await store.fail_data_job(
            job_id=job["job_id"],
            lease_token=claim["lease_token"],
            error_code="private_storage_failure",
            retry_after_seconds=0,
            now=now + timedelta(seconds=1),
        )

        events = await store.list_audit_events(limit=20, offset=0)
        failed_events = [
            event
            for event in events
            if event["action"] == "data.export.failed" and event["resource_id"] == job["job_id"]
        ]
        assert len(failed_events) == 1
        assert failed_events[0]["actor_user_id"] == "user-a"
        assert failed_events[0]["outcome"] == "failure"
        assert failed_events[0]["request_id"] == "request-export-1"
        assert not any("private_storage_failure" in str(event) for event in events)
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_completion_after_cancel_request_records_terminal_cancel(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flow-desk-data-job-complete-cancel.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    now = datetime(2026, 9, 28, tzinfo=UTC)

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="complete-after-cancel-request",
            scope=["preferences"],
            request_id="request-original",
            now=now,
        )
        claim = await store.claim_data_job(
            worker_id="worker-1",
            lease_seconds=30,
            now=now,
        )
        assert claim is not None
        assert await store.request_data_job_cancel(
            "user-a",
            job["job_id"],
            request_id="request-cancel",
            now=now + timedelta(milliseconds=1),
        )
        assert await store.complete_data_job(
            job_id=job["job_id"],
            lease_token=claim["lease_token"],
            result={"artifact_id": "never-published"},
            now=now + timedelta(seconds=1),
        )

        stored = await store.get_data_job("user-a", job["job_id"])
        assert stored is not None
        assert stored["status"] == "cancelled"
        assert stored["result"] is None
        event = next(
            event
            for event in await store.list_audit_events(limit=20, offset=0)
            if event["action"] == "data.export.cancelled" and event["resource_id"] == job["job_id"]
        )
        assert event["actor_user_id"] == "user-a"
        assert event["request_id"] == "request-original"
        assert event["outcome"] == "cancelled"
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_concurrent_workers_cannot_claim_the_same_data_job(tmp_path) -> None:
    database_path = tmp_path / "flow-desk-data-job-concurrency.sqlite"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path}",
        poolclass=NullPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    store = ProductSettingsStore()
    now = datetime(2026, 9, 28, tzinfo=UTC)

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=session_factory))
        await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="one-claim-only",
            scope=["threads"],
            now=now,
        )
        claims = await asyncio.gather(
            store.claim_data_job(worker_id="worker-1", lease_seconds=30, now=now),
            store.claim_data_job(worker_id="worker-2", lease_seconds=30, now=now),
        )
        assert sum(claim is not None for claim in claims) == 1
        stored = await store.list_data_jobs("user-a")
        assert len(stored) == 1
        assert stored[0]["status"] == "running"
        assert stored[0]["attempt"] == 1
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_expired_final_worker_lease_becomes_failed_not_stuck_running(tmp_path) -> None:
    database_path = tmp_path / "flow-desk-data-job-final-lease.sqlite"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path}",
        poolclass=NullPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    store = ProductSettingsStore()
    now = datetime(2026, 9, 28, tzinfo=UTC)

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=session_factory))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="deletion",
            idempotency_key="final-lease-expiry",
            scope=["threads"],
            max_attempts=1,
            now=now,
        )
        claim = await store.claim_data_job(worker_id="worker-1", lease_seconds=5, now=now)
        assert claim is not None
        assert (
            await store.claim_data_job(
                worker_id="worker-2",
                lease_seconds=5,
                now=now + timedelta(seconds=6),
            )
            is None
        )
        stored = await store.get_data_job("user-a", job["job_id"])
        assert stored is not None
        assert stored["status"] == "failed"
        assert stored["error_code"] == "worker_lease_exhausted"
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_data_job_creation_has_a_durable_per_owner_hourly_limit(tmp_path) -> None:
    database_path = tmp_path / "flow-desk-data-job-rate-limit.sqlite"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    window_start = datetime(2026, 9, 28, tzinfo=UTC)

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        first = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="hourly-job-0",
            scope=["preferences"],
            now=window_start,
        )
        replay = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="hourly-job-0",
            scope=["preferences"],
            now=window_start + timedelta(seconds=1),
        )
        assert replay["job_id"] == first["job_id"]
        assert await store.request_data_job_cancel(
            "user-a",
            first["job_id"],
            now=window_start + timedelta(seconds=1),
        )

        for index in range(1, 10):
            job = await store.create_data_job(
                owner_user_id="user-a",
                kind="export",
                idempotency_key=f"hourly-job-{index}",
                scope=["preferences"],
                now=window_start + timedelta(seconds=index + 1),
            )
            assert await store.request_data_job_cancel(
                "user-a",
                job["job_id"],
                now=window_start + timedelta(seconds=index + 1),
            )

        with pytest.raises(DataJobRateLimitError) as error:
            await store.create_data_job(
                owner_user_id="user-a",
                kind="export",
                idempotency_key="hourly-job-over-limit",
                scope=["preferences"],
                now=window_start + timedelta(seconds=20),
            )
        assert error.value.retry_after_seconds == 3581

        after_window = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="hourly-job-next-window",
            scope=["preferences"],
            now=window_start + timedelta(hours=1, seconds=1),
        )
        assert after_window["status"] == "queued"
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())
