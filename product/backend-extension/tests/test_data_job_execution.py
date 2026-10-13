"""自有设置导出/删除 worker 的端到端安全边界测试。"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import zipfile
from datetime import UTC, datetime, timedelta

from deerflow_extension_api import (
    ExtensionRuntimeDeps,
    OwnerAgentPage,
    OwnerDataAuthorizationError,
    OwnerFile,
    OwnerFileEntry,
    OwnerFilePage,
    OwnerFiles,
    OwnerMessagePage,
    OwnerProjectPage,
    OwnerRunPage,
    OwnerScheduledTaskPage,
    OwnerThreadPage,
)
from flow_desk_product_extension.jobs import DataJobWorker, _run_cursor_key
from flow_desk_product_extension.settings import ProductSettingsStore
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


def test_run_cursor_comparison_normalizes_timezone_offsets() -> None:
    older = _run_cursor_key("2026-10-08T13:00:00+01:00", "run-a")
    newer = _run_cursor_key("2026-10-08T12:30:00Z", "run-b")

    assert older < newer


class FakeOwnerDataReader:
    """为产品 worker 测试模拟 Gateway 只读能力，并记录每次 owner 传参。"""

    def __init__(self) -> None:
        self.thread_calls: list[tuple[str, int, int]] = []
        self.message_calls: list[tuple[str, str, int, int | None]] = []
        self.run_calls: list[tuple[str, str, int, str | None, str | None]] = []
        self.project_calls: list[tuple[str, int, int]] = []
        self.scheduled_task_calls: list[tuple[str, int, int]] = []
        self.agent_calls: list[tuple[str, int, int]] = []
        self.memory_calls: list[str] = []
        self.file_calls: list[tuple[str, int, int]] = []

    async def read_files(self, *, user_id: str, max_files: int, max_total_bytes: int):
        self.file_calls.append((user_id, max_files, max_total_bytes))
        payload = b"private owner file"
        return OwnerFiles(
            files=(
                OwnerFile(
                    source="thread_upload",
                    name="notes.txt",
                    size_bytes=len(payload),
                    content=payload,
                    thread_id="thread-a",
                ),
                OwnerFile(
                    source="thread_workspace",
                    name="docs/guide.md",
                    size_bytes=len(b"workspace note"),
                    content=b"workspace note",
                    thread_id="thread-a",
                ),
                OwnerFile(
                    source="thread_workspace",
                    name="../outside.txt",
                    size_bytes=len(b"must not export"),
                    content=b"must not export",
                    thread_id="thread-a",
                ),
                OwnerFile(
                    source="thread_workspace",
                    name="C:/outside.txt",
                    size_bytes=len(b"must not export"),
                    content=b"must not export",
                    thread_id="thread-a",
                ),
                OwnerFile(
                    source="project_document",
                    name="brief.pdf",
                    size_bytes=3,
                    content=b"pdf",
                    project_id="project-a",
                ),
            ),
            truncated=True,
            failed_count=1,
            coverage_notes=(
                "Gateway skipped a file changed during export.",
                "Skipped 1 workspace file with sensitive-looking workspace paths.",
            ),
        )

    async def list_agents(self, *, user_id: str, limit: int, offset: int):
        self.agent_calls.append((user_id, limit, offset))
        rows = (
            {
                "name": "reviewer",
                "description": "Reviews code",
                "soul": "Review carefully.",
            },
            {"name": "planner", "description": "Plans projects", "soul": "Plan."},
        )
        page = rows[offset : offset + limit]
        has_more = offset + len(page) < len(rows)
        return OwnerAgentPage(
            agents=page,
            has_more=has_more,
            next_offset=offset + limit if has_more else None,
        )

    async def read_memory(self, *, user_id: str):
        self.memory_calls.append(user_id)
        return {
            "version": "2.0",
            "lastUpdated": "2026-09-20T12:00:00Z",
            "user": {"workContext": {"summary": "My work", "updatedAt": "today"}},
            "history": {},
            "facts": [
                {
                    "id": "fact-1",
                    "content": "Uses Python",
                    "category": "preference",
                    "confidence": 0.9,
                    "scope": {"userId": user_id, "agentName": "__default__"},
                    "revision": 3,
                    "credential": "must not leak",
                }
            ],
            "backend_secret": "must not leak",
        }

    async def list_scheduled_tasks(self, *, user_id: str, limit: int, offset: int):
        self.scheduled_task_calls.append((user_id, limit, offset))
        rows = (
            {"id": "task-a", "title": "Morning brief", "prompt": "Summarize my tasks"},
            {"id": "task-b", "title": "Evening review", "prompt": "Review my notes"},
        )
        page = rows[offset : offset + limit]
        has_more = offset + len(page) < len(rows)
        return OwnerScheduledTaskPage(
            tasks=page,
            has_more=has_more,
            next_offset=offset + limit if has_more else None,
        )

    async def list_projects(self, *, user_id: str, limit: int, offset: int):
        self.project_calls.append((user_id, limit, offset))
        if offset == 0:
            return OwnerProjectPage(
                projects=(
                    {
                        "id": "project-a",
                        "name": "Alpha",
                        "instructions": "Alpha instructions",
                        "presentation": {"icon": "folder"},
                        "status": "active",
                        "created_at": "2026-09-01T00:00:00+00:00",
                        "updated_at": "2026-09-02T00:00:00+00:00",
                    },
                    {
                        "id": "project-b",
                        "name": "Beta",
                        "instructions": "",
                        "presentation": {},
                        "status": "archived",
                        "created_at": "2026-09-03T00:00:00+00:00",
                        "updated_at": "2026-09-04T00:00:00+00:00",
                    },
                ),
                has_more=True,
                next_offset=2,
            )
        return OwnerProjectPage(
            projects=(
                {
                    "id": "project-c",
                    "name": "Gamma",
                    "instructions": "",
                    "presentation": {},
                    "status": "active",
                    "created_at": "2026-09-05T00:00:00+00:00",
                    "updated_at": "2026-09-06T00:00:00+00:00",
                },
            ),
            has_more=False,
        )

    async def list_threads(self, *, user_id: str, limit: int, offset: int):
        self.thread_calls.append((user_id, limit, offset))
        if offset == 0:
            return OwnerThreadPage(
                threads=(
                    {"thread_id": "thread-a", "display_name": "A"},
                    {"thread_id": "thread-b", "display_name": "B"},
                ),
                has_more=True,
                next_offset=2,
            )
        return OwnerThreadPage(
            threads=({"thread_id": "thread-c", "display_name": "C"},),
            has_more=False,
        )

    async def read_thread_messages_page(
        self,
        *,
        user_id: str,
        thread_id: str,
        limit: int,
        before_seq: int | None = None,
    ):
        self.message_calls.append((user_id, thread_id, limit, before_seq))
        if thread_id == "thread-a" and before_seq is None:
            return OwnerMessagePage(
                messages=({"seq": 3, "type": "human", "content": "new"},),
                has_more=True,
                next_before_seq=3,
            )
        if thread_id == "thread-a":
            return OwnerMessagePage(
                messages=({"seq": 1, "type": "human", "content": "old"},),
                has_more=False,
            )
        return OwnerMessagePage(messages=(), has_more=False)

    async def list_thread_runs(
        self,
        *,
        user_id: str,
        thread_id: str,
        limit: int,
        before_created_at: str | None = None,
        before_run_id: str | None = None,
    ):
        self.run_calls.append((user_id, thread_id, limit, before_created_at, before_run_id))
        if thread_id != "thread-a":
            return OwnerRunPage()
        if before_run_id is None:
            return OwnerRunPage(
                runs=(
                    {
                        "run_id": "run-new",
                        "status": "success",
                        "total_tokens": 50,
                    },
                    {
                        "run_id": "run-old",
                        "status": "error",
                        "total_tokens": 10,
                    },
                ),
                has_more=True,
                next_before_created_at="2026-10-07T12:00:00+00:00",
                next_before_run_id="run-old",
            )
        return OwnerRunPage(
            runs=({"run_id": "run-older", "status": "success", "total_tokens": 15},),
        )


def test_worker_rechecks_authorization_before_each_data_batch(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-worker-auth-revoked.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    reader = FakeOwnerDataReader()

    class RevokeAtFirstBatch:
        calls = 0

        async def authorize(self, *, user_id: str, scopes) -> None:
            assert user_id == "user-a"
            assert scopes
            self.calls += 1
            if self.calls == 2:
                raise OwnerDataAuthorizationError(403, "Permission revoked")

    authorizer = RevokeAtFirstBatch()
    worker = DataJobWorker(
        store,
        tmp_path / "worker-auth-artifacts",
        owner_data_reader=reader,
        owner_data_authorizer=authorizer,
        worker_id="revoked-worker",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="revoked-before-first-page",
            scope=["threads"],
        )

        assert await worker.run_once()
        failed = await store.get_data_job("user-a", job["job_id"])
        assert failed is not None
        assert failed["status"] == "failed"
        assert failed["error_code"] == "authorization_revoked"
        assert authorizer.calls == 2
        assert reader.thread_calls == []
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_worker_retries_when_current_authorization_is_unavailable(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-worker-auth-unavailable.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()

    class UnavailableAuthorization:
        async def authorize(self, *, user_id: str, scopes) -> None:
            raise OwnerDataAuthorizationError(503, "Authorization unavailable")

    worker = DataJobWorker(
        store,
        tmp_path / "worker-auth-retry-artifacts",
        owner_data_authorizer=UnavailableAuthorization(),
        worker_id="unavailable-worker",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="authorization-outage",
            scope=["preferences"],
        )

        assert await worker.run_once()
        retry = await store.get_data_job("user-a", job["job_id"])
        assert retry is not None
        assert retry["status"] == "retry_wait"
        assert retry["error_code"] == "authorization_unavailable"
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


class FakeScheduledTaskDeletionReader:
    """可变 owner 清单，验证删除后的复查与部分完成状态。"""

    def __init__(self) -> None:
        self.tasks = [{"id": "task-a"}, {"id": "task-b"}]
        self.calls: list[tuple[str, int, int]] = []

    async def list_scheduled_tasks(self, *, user_id: str, limit: int, offset: int):
        self.calls.append((user_id, limit, offset))
        page = self.tasks[offset : offset + limit]
        has_more = offset + len(page) < len(self.tasks)
        return OwnerScheduledTaskPage(
            tasks=tuple(page),
            has_more=has_more,
            next_offset=offset + len(page) if has_more else None,
        )


class FakeScheduledTaskDeleter:
    def __init__(self, reader: FakeScheduledTaskDeletionReader) -> None:
        self.reader = reader
        self.calls: list[tuple[str, str]] = []

    async def delete_scheduled_task(self, *, user_id: str, task_id: str) -> str:
        self.calls.append((user_id, task_id))
        if task_id == "task-a":
            self.reader.tasks = [task for task in self.reader.tasks if task["id"] != task_id]
            # 模拟定义已在前一次尝试删除，但 worker 尚未保存最终结果就崩溃。
            return "not_found"
        return "executing"


def test_preferences_export_is_owner_scoped_checksummed_and_time_limited(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-export.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    artifact_root = tmp_path / "private-artifacts"
    worker = DataJobWorker(store, artifact_root, worker_id="worker-test")

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        await store.put_for_user("user-a", "workspace.layout", {"density": "compact"})
        await store.put_for_user("user-b", "workspace.layout", {"density": "private"})
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="preferences-export-1",
            scope=["preferences"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        artifact = artifact_root / f"{completed['result']['artifact_id']}.json"
        assert artifact.is_file()
        payload = artifact.read_bytes()
        assert hashlib.sha256(payload).hexdigest() == completed["result"]["sha256"]
        document = json.loads(payload)
        assert document["owner_user_id"] == "user-a"
        assert document["resources"]["preferences"] == [
            {"key": "workspace.layout", "value": {"density": "compact"}}
        ]
        assert "private" not in payload.decode("utf-8")
        assert completed["result"]["expires_at"]
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_account_export_bundles_owner_scopes_in_a_partial_zip(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-account-export.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    reader = FakeOwnerDataReader()
    artifact_root = tmp_path / "private-account-artifacts"
    worker = DataJobWorker(
        store,
        artifact_root,
        owner_data_reader=reader,
        worker_id="account-export-worker",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        await store.put_for_user("user-a", "workspace.layout", {"density": "compact"})
        await store.put_for_user("user-b", "workspace.layout", {"density": "private"})
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="account-export-1",
            scope=["account"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None and completed["status"] == "completed"
        assert completed["result"]["completeness"] == "partial"
        archive = artifact_root / f"{completed['result']['artifact_id']}.json"
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == completed["result"]["sha256"]

        with zipfile.ZipFile(archive) as bundle:
            assert bundle.testzip() is None
            assert set(bundle.namelist()) == {
                "manifest.json",
                "data/preferences.json",
                "data/threads.json",
                "data/projects.json",
                "data/scheduled_tasks.json",
                "data/agents.json",
                "data/memory.json",
                "data/files.json",
            }
            manifest = json.loads(bundle.read("manifest.json"))
            assert manifest["completeness"] == "partial"
            assert manifest["included_scopes"] == [
                "preferences",
                "threads",
                "projects",
                "scheduled_tasks",
                "agents",
                "memory",
                "files",
            ]
            preferences = json.loads(bundle.read("data/preferences.json"))
            assert preferences["owner_user_id"] == "user-a"
            assert preferences["resources"]["preferences"] == [
                {"key": "workspace.layout", "value": {"density": "compact"}}
            ]
            memory_export = bundle.read("data/memory.json")
            assert b"backend_secret" not in memory_export
            assert b"must not export" not in b"".join(
                bundle.read(name) for name in bundle.namelist()
            )
        assert reader.thread_calls and all(call[0] == "user-a" for call in reader.thread_calls)
        assert reader.project_calls and all(call[0] == "user-a" for call in reader.project_calls)
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_account_export_records_unavailable_scopes_instead_of_claiming_full_coverage(
    tmp_path,
) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-account-export-partial.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    artifact_root = tmp_path / "private-account-partial-artifacts"
    worker = DataJobWorker(store, artifact_root, worker_id="account-export-partial-worker")

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="account-export-partial-1",
            scope=["account"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None and completed["status"] == "completed"
        assert completed["result"]["completeness"] == "partial"
        archive = artifact_root / f"{completed['result']['artifact_id']}.json"
        with zipfile.ZipFile(archive) as bundle:
            manifest = json.loads(bundle.read("manifest.json"))
            assert manifest["included_scopes"] == ["preferences"]
            assert manifest["scopes"]["threads"]["status"] == "unavailable"
            assert manifest["scopes"]["files"]["status"] == "unavailable"
            assert "data/threads.json" not in bundle.namelist()
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_account_export_cancellation_during_a_scope_does_not_publish_a_bundle(
    tmp_path,
) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-account-export-cancel.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    entered_reader = asyncio.Event()
    release_reader = asyncio.Event()

    class BlockingOwnerDataReader(FakeOwnerDataReader):
        async def list_threads(self, *, user_id: str, limit: int, offset: int):
            entered_reader.set()
            await release_reader.wait()
            return await super().list_threads(user_id=user_id, limit=limit, offset=offset)

    artifact_root = tmp_path / "private-account-cancel-artifacts"
    worker = DataJobWorker(
        store,
        artifact_root,
        owner_data_reader=BlockingOwnerDataReader(),
        worker_id="account-export-cancel-worker",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="account-export-cancel-1",
            scope=["account"],
        )
        execution = asyncio.create_task(worker.run_once())
        try:
            await asyncio.wait_for(entered_reader.wait(), timeout=4)
            await store.request_data_job_cancel("user-a", job["job_id"])
        finally:
            release_reader.set()
        assert await asyncio.wait_for(execution, timeout=4)

        cancelled = await store.get_data_job("user-a", job["job_id"])
        assert cancelled is not None and cancelled["status"] == "cancelled"
        assert not list(artifact_root.glob("*.json"))
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_preferences_deletion_is_atomic_and_does_not_touch_other_owners(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-delete.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    worker = DataJobWorker(store, tmp_path / "private-artifacts", worker_id="worker-test")

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        await store.put_for_user("user-a", "workspace.layout", {"density": "compact"})
        await store.put_for_user("user-b", "workspace.layout", {"density": "private"})
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="deletion",
            idempotency_key="preferences-delete-1",
            scope=["preferences"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"]["deleted_resources_count"] == 1
        assert await store.list_for_user("user-a") == []
        assert await store.list_for_user("user-b") == [
            {"key": "workspace.layout", "value": {"density": "private"}}
        ]
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_threads_export_pages_owned_history_and_is_marked_partial(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-threads-export.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    reader = FakeOwnerDataReader()
    artifact_root = tmp_path / "private-thread-artifacts"
    worker = DataJobWorker(
        store,
        artifact_root,
        owner_data_reader=reader,
        worker_id="worker-test",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="threads-export-1",
            scope=["threads"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"]["completeness"] == "partial"
        assert completed["result"]["failed_resources_count"] == 0

        artifact = artifact_root / f"{completed['result']['artifact_id']}.json"
        document = json.loads(artifact.read_bytes())
        assert document["scope"] == ["threads"]
        assert document["completeness"] == "partial"
        assert document["resources"]["threads"] == [
            {
                "thread": {"thread_id": "thread-a", "display_name": "A"},
                "messages": [
                    {"seq": 3, "type": "human", "content": "new"},
                    {"seq": 1, "type": "human", "content": "old"},
                ],
                "runs": [
                    {"run_id": "run-new", "status": "success", "total_tokens": 50},
                    {"run_id": "run-old", "status": "error", "total_tokens": 10},
                    {"run_id": "run-older", "status": "success", "total_tokens": 15},
                ],
            },
            {"thread": {"thread_id": "thread-b", "display_name": "B"}, "messages": [], "runs": []},
            {"thread": {"thread_id": "thread-c", "display_name": "C"}, "messages": [], "runs": []},
        ]
        assert all(call[0] == "user-a" for call in reader.thread_calls)
        assert all(call[0] == "user-a" for call in reader.message_calls)
        assert [call[1] for call in reader.message_calls] == [
            "thread-a",
            "thread-a",
            "thread-b",
            "thread-c",
        ]
        assert reader.message_calls[1][3] == 3
        assert all(call[0] == "user-a" for call in reader.run_calls)
        assert [call[1] for call in reader.run_calls] == [
            "thread-a",
            "thread-a",
            "thread-b",
            "thread-c",
        ]
        assert reader.run_calls[1][3:] == ("2026-10-07T12:00:00+00:00", "run-old")
        assert document["export_summary"]["run_count"] == 3
        assert any("checkpoint" in note for note in document["coverage_notes"])
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_threads_export_without_gateway_reader_fails_closed(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-no-reader.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    worker = DataJobWorker(store, tmp_path / "private-artifacts")

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="threads-export-no-reader",
            scope=["threads"],
        )
        assert await worker.run_once()
        failed = await store.get_data_job("user-a", job["job_id"])
        assert failed is not None
        assert failed["status"] == "failed"
        assert failed["error_code"] == "scope_unavailable"
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_projects_export_is_owner_scoped_bounded_and_marked_partial(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-projects-export.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    reader = FakeOwnerDataReader()
    artifact_root = tmp_path / "private-project-artifacts"
    worker = DataJobWorker(
        store,
        artifact_root,
        owner_data_reader=reader,
        worker_id="worker-test",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="projects-export-1",
            scope=["projects"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"]["completeness"] == "partial"

        artifact = artifact_root / f"{completed['result']['artifact_id']}.json"
        document = json.loads(artifact.read_bytes())
        assert document["scope"] == ["projects"]
        assert document["completeness"] == "partial"
        assert [project["id"] for project in document["resources"]["projects"]] == [
            "project-a",
            "project-b",
            "project-c",
        ]
        assert reader.project_calls == [
            ("user-a", 100, 0),
            ("user-a", 100, 2),
        ]
        assert document["export_summary"] == {
            "project_count": 3,
            "failed_resources_count": 0,
            "truncated": False,
        }
        assert any("document contents" in note for note in document["coverage_notes"])
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_project_deletion_collects_owner_inventory_before_removing_projects(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-projects-delete.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()

    class Reader:
        def __init__(self) -> None:
            self.projects = [{"id": "project-a"}, {"id": "project-b"}]
            self.calls: list[tuple[str, int, int]] = []

        async def list_projects(self, *, user_id: str, limit: int, offset: int):
            self.calls.append((user_id, limit, offset))
            page = self.projects[offset : offset + limit]
            has_more = offset + len(page) < len(self.projects)
            return OwnerProjectPage(
                projects=tuple(page),
                has_more=has_more,
                next_offset=offset + len(page) if has_more else None,
            )

    class Deleter:
        supports_project_delete = True

        def __init__(self, reader: Reader) -> None:
            self.reader = reader
            self.calls: list[tuple[str, str]] = []

        async def delete_project(self, *, user_id: str, project_id: str):
            self.calls.append((user_id, project_id))
            self.reader.projects = [
                project for project in self.reader.projects if project["id"] != project_id
            ]
            return "deleted"

    reader = Reader()
    deleter = Deleter(reader)
    worker = DataJobWorker(
        store,
        tmp_path / "private-project-delete-artifacts",
        owner_data_reader=reader,
        owner_data_deleter=deleter,
        worker_id="worker-test",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="deletion",
            idempotency_key="projects-delete-1",
            scope=["projects"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"] == {
            "completeness": "complete",
            "deleted_resources_count": 2,
            "failed_resources_count": 0,
            "remaining_resources_count": 0,
        }
        assert deleter.calls == [("user-a", "project-a"), ("user-a", "project-b")]
        assert reader.calls[0] == ("user-a", 100, 0)
        assert reader.calls[-1] == ("user-a", 100, 0)
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_scheduled_tasks_export_is_owner_scoped_and_excludes_run_history(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-scheduled-tasks-export.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    reader = FakeOwnerDataReader()
    artifact_root = tmp_path / "private-scheduled-task-artifacts"
    worker = DataJobWorker(
        store,
        artifact_root,
        owner_data_reader=reader,
        worker_id="worker-test",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="scheduled-tasks-export-1",
            scope=["scheduled_tasks"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"]["completeness"] == "partial"

        artifact = artifact_root / f"{completed['result']['artifact_id']}.json"
        document = json.loads(artifact.read_bytes())
        assert document["scope"] == ["scheduled_tasks"]
        assert document["completeness"] == "partial"
        assert [task["id"] for task in document["resources"]["scheduled_tasks"]] == [
            "task-a",
            "task-b",
        ]
        assert reader.scheduled_task_calls == [("user-a", 100, 0)]
        assert document["export_summary"] == {
            "scheduled_task_count": 2,
            "failed_resources_count": 0,
            "truncated": False,
        }
        assert "run history" in " ".join(document["coverage_notes"]).lower()
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_scheduled_task_deletion_keeps_running_definition_and_reports_partial(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-scheduled-tasks-delete.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    reader = FakeScheduledTaskDeletionReader()
    deleter = FakeScheduledTaskDeleter(reader)
    worker = DataJobWorker(
        store,
        tmp_path / "private-scheduled-task-delete-artifacts",
        owner_data_reader=reader,
        owner_data_deleter=deleter,
        worker_id="worker-test",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="deletion",
            idempotency_key="scheduled-tasks-delete-1",
            scope=["scheduled_tasks"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"] == {
            "completeness": "partial",
            "deleted_resources_count": 1,
            "failed_resources_count": 0,
            "remaining_resources_count": 1,
        }
        assert deleter.calls == [("user-a", "task-a"), ("user-a", "task-b")]
        assert reader.tasks == [{"id": "task-b"}]
        assert all(call[0] == "user-a" for call in reader.calls)
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_custom_agent_deletion_is_owner_scoped_and_reports_partial_failures(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-custom-agents-delete.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()

    class Reader:
        calls: list[tuple[str, int, int]] = []
        names = ["writer", "blocked", "../shared"]

        async def list_agents(self, *, user_id: str, limit: int, offset: int):
            self.calls.append((user_id, limit, offset))
            rows = [{"name": name} for name in self.names]
            page = rows[offset : offset + limit]
            has_more = offset + len(page) < len(rows)
            return OwnerAgentPage(
                agents=page,
                has_more=has_more,
                next_offset=offset + limit if has_more else None,
            )

    class Deleter:
        calls: list[tuple[str, str]] = []

        async def delete_agent(self, *, user_id: str, name: str):
            self.calls.append((user_id, name))
            if name == "blocked":
                return "not_custom_agent"
            reader.names.remove(name)
            return "deleted"

    reader = Reader()
    deleter = Deleter()
    worker = DataJobWorker(
        store,
        tmp_path / "private-custom-agent-delete-artifacts",
        owner_data_reader=reader,
        owner_data_deleter=deleter,
        worker_id="worker-test",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="deletion",
            idempotency_key="custom-agents-delete-1",
            scope=["agents"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"] == {
            "completeness": "partial",
            "deleted_resources_count": 1,
            "failed_resources_count": 2,
            "remaining_resources_count": 1,
        }
        # 路径样式的无效 name 在产品 worker 层即被拒绝，不会交给宿主 store。
        assert deleter.calls == [("user-a", "writer"), ("user-a", "blocked")]
        assert reader.calls == [("user-a", 100, 0), ("user-a", 100, 0)]
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_thread_history_deletion_is_owner_scoped_and_reports_busy_threads(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-thread-history-delete.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()

    class Reader:
        thread_ids = ["thread-a", "thread-b", "thread-busy"]
        calls: list[tuple[str, int, int]] = []

        async def list_threads(self, *, user_id: str, limit: int, offset: int):
            self.calls.append((user_id, limit, offset))
            rows = [{"thread_id": value} for value in self.thread_ids]
            page = rows[offset : offset + limit]
            has_more = offset + len(page) < len(rows)
            return OwnerThreadPage(
                threads=tuple(page),
                has_more=has_more,
                next_offset=offset + len(page) if has_more else None,
            )

    class Deleter:
        calls: list[tuple[str, str]] = []

        async def delete_thread(self, *, user_id: str, thread_id: str):
            self.calls.append((user_id, thread_id))
            if thread_id == "thread-busy":
                return "executing"
            reader.thread_ids.remove(thread_id)
            return "deleted"

    reader = Reader()
    deleter = Deleter()
    worker = DataJobWorker(
        store,
        tmp_path / "private-thread-history-delete-artifacts",
        owner_data_reader=reader,
        owner_data_deleter=deleter,
        worker_id="worker-test",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="deletion",
            idempotency_key="thread-history-delete-1",
            scope=["threads"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"] == {
            "completeness": "partial",
            "deleted_resources_count": 2,
            "failed_resources_count": 1,
            "remaining_resources_count": 1,
        }
        assert deleter.calls == [
            ("user-a", "thread-a"),
            ("user-a", "thread-b"),
            ("user-a", "thread-busy"),
        ]
        assert reader.calls == [("user-a", 100, 0), ("user-a", 100, 0)]
        assert reader.thread_ids == ["thread-busy"]
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_file_deletion_is_owner_scoped_and_reports_unsupported(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-files-delete.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()

    class Reader:
        files = [
            OwnerFileEntry(
                file_id="thread_upload:thread-a:notes.txt",
                source="thread_upload",
                name="notes.txt",
                size_bytes=10,
                artifact_url="/upload",
                thread_id="thread-a",
            ),
            OwnerFileEntry(
                file_id="project-document:project-a:document-a",
                source="project_document",
                name="brief.pdf",
                size_bytes=20,
                artifact_url="/document",
                project_id="project-a",
                document_id="document-a",
            ),
            OwnerFileEntry(
                file_id="thread_output:thread-a:report.html",
                source="thread_output",
                name="report.html",
                size_bytes=30,
                artifact_url="/output",
                thread_id="thread-a",
            ),
            OwnerFileEntry(
                file_id="thread_workspace:thread-a:docs/guide.md",
                source="thread_workspace",
                name="docs/guide.md",
                size_bytes=40,
                artifact_url="/workspace",
                thread_id="thread-a",
            ),
        ]
        calls: list[tuple[str, int, int, str]] = []

        async def list_files(self, *, user_id: str, limit: int, offset: int, query: str = ""):
            self.calls.append((user_id, limit, offset, query))
            page = self.files[offset : offset + limit]
            has_more = offset + len(page) < len(self.files)
            return OwnerFilePage(
                files=tuple(page),
                total=len(self.files),
                has_more=has_more,
                next_offset=offset + len(page) if has_more else None,
            )

    class Deleter:
        supports_file_delete = True

        def __init__(self, reader: Reader) -> None:
            self.reader = reader
            self.calls: list[tuple[str, str]] = []

        async def delete_file(self, *, user_id: str, file_id: str):
            self.calls.append((user_id, file_id))
            if file_id.startswith("thread_output:") or file_id.startswith("thread_workspace:"):
                return "unsupported"
            self.reader.files = [entry for entry in self.reader.files if entry.file_id != file_id]
            return "trashed" if file_id.startswith("project-document:") else "deleted"

    reader = Reader()
    deleter = Deleter(reader)
    worker = DataJobWorker(
        store,
        tmp_path / "private-file-delete-artifacts",
        owner_data_reader=reader,
        owner_data_deleter=deleter,
        worker_id="worker-test",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="deletion",
            idempotency_key="files-delete-1",
            scope=["files"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"] == {
            "completeness": "partial",
            "deleted_resources_count": 2,
            "failed_resources_count": 2,
            "remaining_resources_count": 2,
        }
        assert deleter.calls == [
            ("user-a", "thread_upload:thread-a:notes.txt"),
            ("user-a", "project-document:project-a:document-a"),
            ("user-a", "thread_output:thread-a:report.html"),
            ("user-a", "thread_workspace:thread-a:docs/guide.md"),
        ]
        assert reader.calls == [
            ("user-a", 100, 0, ""),
            ("user-a", 100, 0, ""),
        ]
        assert {entry.source for entry in reader.files} == {"thread_output", "thread_workspace"}
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_memory_deletion_uses_owner_capability_and_finishes_after_late_cancel(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-memory-delete.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    calls: list[str] = []
    job_id: str | None = None

    class Deleter:
        async def delete_memory(self, *, user_id: str):
            calls.append(user_id)
            # Cancellation arrives while the owner-scoped backend clear is committing.
            assert job_id is not None
            assert await store.request_data_job_cancel("user-a", job_id)
            return "deleted"

    worker = DataJobWorker(
        store,
        tmp_path / "private-memory-delete-artifacts",
        owner_data_deleter=Deleter(),
        worker_id="worker-test",
    )

    async def scenario() -> None:
        nonlocal job_id
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="deletion",
            idempotency_key="memory-delete-1",
            scope=["memory"],
        )
        job_id = job["job_id"]

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job_id)
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["cancel_requested"] is True
        assert completed["result"] == {
            "completeness": "complete",
            "deleted_resources_count": 1,
            "failed_resources_count": 0,
            "remaining_resources_count": 0,
        }
        assert calls == ["user-a"]
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_agents_export_is_owner_scoped_bounded_and_excludes_deployment_bindings(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-agents-export.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    reader = FakeOwnerDataReader()
    artifact_root = tmp_path / "private-agent-artifacts"
    worker = DataJobWorker(
        store,
        artifact_root,
        owner_data_reader=reader,
        worker_id="worker-test",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="agents-export-1",
            scope=["agents"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"]["completeness"] == "partial"

        artifact = artifact_root / f"{completed['result']['artifact_id']}.json"
        document = json.loads(artifact.read_bytes())
        assert document["scope"] == ["agents"]
        assert [agent["name"] for agent in document["resources"]["agents"]] == [
            "reviewer",
            "planner",
        ]
        assert "github" not in json.dumps(document)
        assert reader.agent_calls == [("user-a", 100, 0)]
        assert document["export_summary"] == {
            "agent_count": 2,
            "failed_resources_count": 0,
            "truncated": False,
        }
        assert "deployment" in " ".join(document["coverage_notes"]).lower()
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_memory_export_is_owner_scoped_partial_and_strips_internal_fields(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-memory-export.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    reader = FakeOwnerDataReader()
    artifact_root = tmp_path / "private-memory-artifacts"
    worker = DataJobWorker(
        store,
        artifact_root,
        owner_data_reader=reader,
        worker_id="worker-test",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="memory-export-1",
            scope=["memory"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"]["completeness"] == "partial"

        artifact = artifact_root / f"{completed['result']['artifact_id']}.json"
        document = json.loads(artifact.read_bytes())
        assert document["scope"] == ["memory"]
        assert document["completeness"] == "partial"
        assert document["resources"]["memory"]["user"]["workContext"]["summary"] == "My work"
        assert document["resources"]["memory"]["facts"] == [
            {
                "id": "fact-1",
                "content": "Uses Python",
                "category": "preference",
                "confidence": 0.9,
            }
        ]
        assert "must not leak" not in json.dumps(document)
        assert "backend_secret" not in json.dumps(document)
        assert "scope" not in json.dumps(document["resources"]["memory"]["facts"])
        assert reader.memory_calls == ["user-a"]
        notes = " ".join(document["coverage_notes"]).lower()
        assert "agent" in notes and "default" in notes
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_files_export_is_bounded_partial_and_contains_verified_portable_bytes(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-files-export.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    reader = FakeOwnerDataReader()
    artifact_root = tmp_path / "private-files-artifacts"
    worker = DataJobWorker(
        store,
        artifact_root,
        owner_data_reader=reader,
        worker_id="worker-files-test",
    )

    async def scenario() -> None:
        await store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine)))
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="files-export-1",
            scope=["files"],
        )

        assert await worker.run_once()
        completed = await store.get_data_job("user-a", job["job_id"])
        assert completed is not None
        assert completed["status"] == "completed"
        assert completed["result"]["completeness"] == "partial"
        assert completed["result"]["failed_resources_count"] == 3
        artifact = artifact_root / f"{completed['result']['artifact_id']}.json"
        payload = artifact.read_bytes()
        assert len(payload) == completed["result"]["size_bytes"]
        assert hashlib.sha256(payload).hexdigest() == completed["result"]["sha256"]
        document = json.loads(payload)
        assert document["scope"] == ["files"]
        assert document["completeness"] == "partial"
        assert document["export_summary"] == {
            "file_count": 3,
            "source_bytes": len(b"private owner file") + len(b"workspace note") + 3,
            "failed_resources_count": 3,
            "truncated": True,
        }
        files = document["resources"]["files"]
        assert base64.b64decode(files[0]["content_base64"]) == b"private owner file"
        assert files[0]["sha256"] == hashlib.sha256(b"private owner file").hexdigest()
        assert files[0]["thread_id"] == "thread-a"
        assert files[1]["source"] == "thread_workspace"
        assert files[1]["name"] == "docs/guide.md"
        assert base64.b64decode(files[1]["content_base64"]) == b"workspace note"
        assert files[2]["source"] == "project_document"
        assert base64.b64decode(files[2]["content_base64"]) == b"pdf"
        assert files[2]["project_id"] == "project-a"
        assert "Gateway skipped a file changed during export." in document["coverage_notes"]
        assert any(
            "sensitive-looking workspace paths" in note.lower()
            for note in document["coverage_notes"]
        )
        assert reader.file_calls == [("user-a", 5_001, 7 * 1024 * 1024)]
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())


def test_product_service_starts_worker_with_gateway_granted_artifact_directory(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-service-worker.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    data_directory = tmp_path / "persistent-product-data"
    reader = FakeOwnerDataReader()

    class AllowOwnerDataAuthorizer:
        async def authorize(self, *, user_id: str, scopes) -> None:
            assert user_id == "user-a"
            assert scopes

    async def scenario() -> None:
        await store.start(
            ExtensionRuntimeDeps(
                session_factory=async_sessionmaker(engine),
                product_data_directory=data_directory,
                owner_data_reader=reader,
                owner_data_authorizer=AllowOwnerDataAuthorizer(),
            )
        )
        job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="gateway-worker-export",
            scope=["preferences"],
        )

        async with asyncio.timeout(4):
            while True:
                current = await store.get_data_job("user-a", job["job_id"])
                assert current is not None
                if current["status"] in {"completed", "failed", "partial"}:
                    break
                await asyncio.sleep(0.02)
        assert current["status"] == "completed"
        artifact = await store.data_job_artifact_path("user-a", job["job_id"])
        assert artifact is not None
        assert artifact.is_relative_to(data_directory.resolve())
        assert (
            await store.data_job_artifact_path(
                "user-a",
                job["job_id"],
                now=datetime.now(UTC) + timedelta(hours=25),
            )
            is None
        )

        thread_job = await store.create_data_job(
            owner_user_id="user-a",
            kind="export",
            idempotency_key="gateway-worker-thread-export",
            scope=["threads"],
        )
        async with asyncio.timeout(4):
            while True:
                thread_result = await store.get_data_job("user-a", thread_job["job_id"])
                assert thread_result is not None
                if thread_result["status"] in {"completed", "failed", "partial"}:
                    break
                await asyncio.sleep(0.02)
        assert thread_result["status"] == "completed"
        assert thread_result["result"]["completeness"] == "partial"
        assert reader.thread_calls and all(call[0] == "user-a" for call in reader.thread_calls)
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(engine.dispose())
