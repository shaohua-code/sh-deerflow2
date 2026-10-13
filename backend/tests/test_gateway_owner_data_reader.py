"""Owner-scoped data reader offered to trusted product extensions."""

from __future__ import annotations

from types import SimpleNamespace

import pytest


class _ThreadStore:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.search_call = None
        self.get_calls: list[tuple[str, str]] = []

    async def search(self, *, limit: int, offset: int, user_id: str, **_kwargs):
        self.search_call = {"limit": limit, "offset": offset, "user_id": user_id}
        return self.rows[offset : offset + limit]

    async def get(self, thread_id: str, *, user_id: str):
        self.get_calls.append((thread_id, user_id))
        row = next((item for item in self.rows if item["thread_id"] == thread_id), None)
        return row if row is not None and row.get("user_id") == user_id else None


class _EventStore:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.list_call = None

    async def list_messages(self, thread_id: str, *, limit: int, before_seq=None, user_id=None):
        self.list_call = {
            "thread_id": thread_id,
            "limit": limit,
            "before_seq": before_seq,
            "user_id": user_id,
        }
        rows = [row for row in self.rows if before_seq is None or row["seq"] < before_seq]
        return rows[-limit:]


class _RunManager:
    async def list_successful_regenerate_sources(self, thread_id, *, user_id):
        return set()

    async def list_edit_replay_visibility(self, thread_id, *, user_id):
        return SimpleNamespace(hidden_source_run_ids=set(), hidden_attempt_run_ids=set())


class _RunStore:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.list_call = None

    async def list_by_thread(
        self,
        thread_id: str,
        *,
        user_id: str,
        limit: int,
        before_created_at: str | None = None,
        before_run_id: str | None = None,
    ):
        self.list_call = {
            "thread_id": thread_id,
            "user_id": user_id,
            "limit": limit,
            "before_created_at": before_created_at,
            "before_run_id": before_run_id,
        }
        rows = [row for row in self.rows if row["thread_id"] == thread_id and row["user_id"] == user_id and (before_created_at is None or (row["created_at"], row["run_id"]) < (before_created_at, before_run_id))]
        return sorted(rows, key=lambda row: (row["created_at"], row["run_id"]), reverse=True)[:limit]


class _ProjectRepository:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.list_call = None

    async def list(self, *, user_id: str, limit: int, offset: int, status=None):
        self.list_call = {
            "user_id": user_id,
            "limit": limit,
            "offset": offset,
            "status": status,
        }
        owned = [row for row in self.rows if row.get("user_id") == user_id]
        return owned[offset : offset + limit]


class _ScheduledTaskRepository:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.list_call = None

    async def list_by_user(self, user_id: str, *, limit: int, offset: int):
        self.list_call = {"user_id": user_id, "limit": limit, "offset": offset}
        owned = [row for row in self.rows if row.get("user_id") == user_id]
        return owned[offset : offset + limit]


class _AgentStore:
    def __init__(self, rows):
        self.rows = rows
        self.list_call = None

    def list_owned(self, *, user_id: str, limit: int, offset: int):
        self.list_call = {"user_id": user_id, "limit": limit, "offset": offset}
        return self.rows.get(user_id, [])[offset : offset + limit]


class _MemoryManager:
    def __init__(self, document: dict) -> None:
        self.document = document
        self.read_users: list[str | None] = []

    def get_memory(self, *, user_id: str | None = None):
        self.read_users.append(user_id)
        return self.document


class _ProjectDocumentRepository:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.list_call = None
        self.get_calls: list[tuple[str, str]] = []

    async def list_active(self, project_id: str, *, limit: int, offset: int, user_id: str):
        self.list_call = (project_id, limit, offset, user_id)
        return [row for row in self.rows if row.get("project_id") == project_id and row.get("user_id") == user_id][offset : offset + limit]

    async def get(self, document_id: str, *, user_id: str):
        self.get_calls.append((document_id, user_id))
        return next(
            (row for row in self.rows if row.get("id") == document_id and row.get("user_id") == user_id),
            None,
        )


@pytest.mark.asyncio
async def test_thread_inventory_is_owner_scoped_and_redacts_private_metadata():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    rows = [
        {
            "thread_id": "owned-1",
            "user_id": "alice",
            "display_name": "My conversation",
            "status": "idle",
            "created_at": "2026-09-01T00:00:00+00:00",
            "updated_at": "2026-09-02T00:00:00+00:00",
            "project_id": "project-1",
            "metadata": {"private": "must not be exported"},
        },
        {
            "thread_id": "owned-2",
            "user_id": "alice",
            "display_name": None,
            "status": "idle",
            "metadata": {"private": "must not be exported"},
        },
        {"thread_id": "foreign", "user_id": "bob", "metadata": {"secret": True}},
    ]
    store = _ThreadStore(rows)
    reader = GatewayOwnerDataReader(store, _EventStore([]), _RunManager())

    page = await reader.list_threads(user_id="alice", limit=2, offset=0)

    assert store.search_call == {"limit": 3, "offset": 0, "user_id": "alice"}
    assert [row["thread_id"] for row in page.threads] == ["owned-1", "owned-2"]
    assert page.has_more is False
    assert page.next_offset is None
    assert page.threads[0] == {
        "thread_id": "owned-1",
        "display_name": "My conversation",
        "status": "idle",
        "created_at": "2026-09-01T00:00:00+00:00",
        "updated_at": "2026-09-02T00:00:00+00:00",
        "project_id": "project-1",
    }


@pytest.mark.asyncio
async def test_message_page_requires_owned_thread_and_passes_owner_to_event_store():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    rows = [
        {"seq": 1, "run_id": "run-1", "event_type": "human.message", "content": {"type": "human", "content": "hello"}, "metadata": {}},
        {"seq": 2, "run_id": "run-1", "event_type": "llm.ai.response", "content": {"type": "ai", "content": "world"}, "metadata": {}},
    ]
    threads = _ThreadStore([{"thread_id": "owned", "user_id": "alice"}, {"thread_id": "foreign", "user_id": "bob"}])
    events = _EventStore(rows)
    reader = GatewayOwnerDataReader(threads, events, _RunManager())

    foreign_page = await reader.read_thread_messages_page(user_id="alice", thread_id="foreign", limit=1)
    page = await reader.read_thread_messages_page(user_id="alice", thread_id="owned", limit=1)

    assert foreign_page is None
    assert threads.get_calls == [("foreign", "alice"), ("owned", "alice")]
    assert events.list_call["user_id"] == "alice"
    assert events.list_call["thread_id"] == "owned"
    assert [row["seq"] for row in page.messages] == [2]
    assert page.has_more is True
    assert page.next_before_seq == 2


@pytest.mark.asyncio
async def test_run_page_requires_owned_thread_and_exports_only_safe_owner_fields():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    threads = _ThreadStore([{"thread_id": "owned", "user_id": "alice"}])
    runs = _RunStore(
        [
            {
                "run_id": "run-new",
                "thread_id": "owned",
                "user_id": "alice",
                "operation_kind": "run",
                "status": "success",
                "assistant_id": "researcher",
                "created_at": "2026-10-08T12:00:00+00:00",
                "updated_at": "2026-10-08T12:01:00+00:00",
                "stop_reason": "completed",
                "total_input_tokens": 20,
                "total_output_tokens": 30,
                "total_tokens": 50,
                "llm_call_count": 2,
                "lead_agent_tokens": 40,
                "subagent_tokens": 10,
                "middleware_tokens": 0,
                "error": "private traceback",
                "kwargs": {"messages": [{"content": "private prompt"}]},
                "metadata": {"credential": "private"},
                "owner_worker_id": "private-worker",
            },
            {
                "run_id": "run-old",
                "thread_id": "owned",
                "user_id": "alice",
                "operation_kind": "run",
                "status": "error",
                "created_at": "2026-10-07T12:00:00+00:00",
                "updated_at": "2026-10-07T12:01:00+00:00",
                "error": "private error text",
            },
        ]
    )
    reader = GatewayOwnerDataReader(
        threads,
        _EventStore([]),
        _RunManager(),
        run_store=runs,
    )

    page = await reader.list_thread_runs(user_id="alice", thread_id="owned", limit=1)

    assert runs.list_call == {
        "thread_id": "owned",
        "user_id": "alice",
        "limit": 2,
        "before_created_at": None,
        "before_run_id": None,
    }
    assert page is not None
    assert page.runs == (
        {
            "run_id": "run-new",
            "assistant_id": "researcher",
            "status": "success",
            "created_at": "2026-10-08T12:00:00+00:00",
            "updated_at": "2026-10-08T12:01:00+00:00",
            "total_input_tokens": 20,
            "total_output_tokens": 30,
            "total_tokens": 50,
            "llm_call_count": 2,
            "lead_agent_tokens": 40,
            "subagent_tokens": 10,
            "middleware_tokens": 0,
        },
    )
    assert page.has_more
    assert page.next_before_created_at == "2026-10-08T12:00:00+00:00"
    assert page.next_before_run_id == "run-new"
    assert "error" not in page.runs[0]
    assert "kwargs" not in page.runs[0]
    assert "metadata" not in page.runs[0]
    assert "stop_reason" not in page.runs[0]
    assert await reader.list_thread_runs(user_id="alice", thread_id="foreign", limit=1) is None


@pytest.mark.asyncio
async def test_run_reader_fails_closed_if_store_ignores_owner_filter():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    threads = _ThreadStore([{"thread_id": "owned", "user_id": "alice"}])
    runs = _RunStore(
        [
            {
                "run_id": "foreign-run",
                "thread_id": "owned",
                "user_id": "bob",
                "operation_kind": "run",
                "status": "success",
                "created_at": "2026-10-08T12:00:00+00:00",
            }
        ]
    )

    class IgnoresOwnerRunStore(_RunStore):
        async def list_by_thread(self, thread_id: str, **kwargs):
            self.list_call = kwargs
            return self.rows

    runs = IgnoresOwnerRunStore(runs.rows)
    reader = GatewayOwnerDataReader(
        threads,
        _EventStore([]),
        _RunManager(),
        run_store=runs,
    )

    with pytest.raises(RuntimeError, match="owner"):
        await reader.list_thread_runs(user_id="alice", thread_id="owned", limit=10)


@pytest.mark.asyncio
async def test_reader_rejects_missing_owner_and_unbounded_page_sizes():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    reader = GatewayOwnerDataReader(_ThreadStore([]), _EventStore([]), _RunManager())

    with pytest.raises(ValueError, match="user_id"):
        await reader.list_threads(user_id="", limit=10, offset=0)
    with pytest.raises(ValueError, match="limit"):
        await reader.list_threads(user_id="alice", limit=201, offset=0)
    with pytest.raises(ValueError, match="before_seq"):
        await reader.read_thread_messages_page(user_id="alice", thread_id="thread", limit=10, before_seq=0)


@pytest.mark.asyncio
async def test_project_inventory_is_bounded_owner_scoped_and_projects_public_fields():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    projects = _ProjectRepository(
        [
            {
                "id": "project-1",
                "user_id": "alice",
                "name": "My project",
                "instructions": "Keep the work focused",
                "presentation": {"icon": "folder"},
                "status": "active",
                "created_at": "2026-09-01T00:00:00+00:00",
                "updated_at": "2026-09-02T00:00:00+00:00",
                "secret_extension_field": "must not leak",
            },
            {"id": "project-foreign", "user_id": "bob", "name": "Private"},
            {"id": "project-2", "user_id": "alice", "name": "Next"},
        ]
    )
    reader = GatewayOwnerDataReader(_ThreadStore([]), _EventStore([]), _RunManager(), project_repository=projects)

    page = await reader.list_projects(user_id="alice", limit=1, offset=0)

    assert projects.list_call == {
        "user_id": "alice",
        "limit": 2,
        "offset": 0,
        "status": None,
    }
    assert page is not None
    assert page.projects == (
        {
            "id": "project-1",
            "name": "My project",
            "instructions": "Keep the work focused",
            "presentation": {"icon": "folder"},
            "status": "active",
            "created_at": "2026-09-01T00:00:00+00:00",
            "updated_at": "2026-09-02T00:00:00+00:00",
        },
    )
    assert page.has_more is True
    assert page.next_offset == 1


@pytest.mark.asyncio
async def test_project_inventory_returns_unavailable_without_repository():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    reader = GatewayOwnerDataReader(_ThreadStore([]), _EventStore([]), _RunManager())

    assert await reader.list_projects(user_id="alice", limit=10, offset=0) is None


@pytest.mark.asyncio
async def test_scheduled_task_inventory_is_owner_scoped_and_excludes_runtime_fields():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    repository = _ScheduledTaskRepository(
        [
            {
                "id": "task-1",
                "user_id": "alice",
                "title": "Daily summary",
                "prompt": "Summarize my own work",
                "context_mode": "fresh_thread_per_run",
                "assistant_id": "lead_agent",
                "schedule_type": "cron",
                "schedule_spec": {"cron": "0 9 * * *"},
                "timezone": "Asia/Shanghai",
                "status": "enabled",
                "overlap_policy": "enqueue",
                "created_at": "2026-09-01T00:00:00+00:00",
                "updated_at": "2026-09-02T00:00:00+00:00",
                "last_error": "private runtime error",
                "lease_owner": "worker-secret",
            },
            {"id": "foreign-task", "user_id": "bob", "title": "Private"},
            {"id": "task-2", "user_id": "alice", "title": "Next"},
        ]
    )
    reader = GatewayOwnerDataReader(
        _ThreadStore([]),
        _EventStore([]),
        _RunManager(),
        scheduled_task_repository=repository,
    )

    page = await reader.list_scheduled_tasks(user_id="alice", limit=1, offset=0)

    assert repository.list_call == {"user_id": "alice", "limit": 2, "offset": 0}
    assert page is not None
    assert page.tasks == (
        {
            "id": "task-1",
            "title": "Daily summary",
            "prompt": "Summarize my own work",
            "context_mode": "fresh_thread_per_run",
            "assistant_id": "lead_agent",
            "schedule_type": "cron",
            "schedule_spec": {"cron": "0 9 * * *"},
            "timezone": "Asia/Shanghai",
            "status": "enabled",
            "overlap_policy": "enqueue",
            "created_at": "2026-09-01T00:00:00+00:00",
            "updated_at": "2026-09-02T00:00:00+00:00",
        },
    )
    assert page.has_more is True
    assert page.next_offset == 1


@pytest.mark.asyncio
async def test_scheduled_task_inventory_returns_unavailable_without_repository():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    reader = GatewayOwnerDataReader(_ThreadStore([]), _EventStore([]), _RunManager())

    assert await reader.list_scheduled_tasks(user_id="alice", limit=10, offset=0) is None


@pytest.mark.asyncio
async def test_agent_inventory_is_paged_owner_scoped_and_excludes_github_bindings():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader
    from deerflow.config.agents_config import AgentConfig, GitHubAgentConfig

    store = _AgentStore(
        {
            "alice": [
                (
                    "alice",
                    AgentConfig(
                        name="reviewer",
                        description="Reviews code",
                        github=GitHubAgentConfig(installation_id=123, bindings=[]),
                    ),
                    "Review carefully.",
                ),
                ("alice", AgentConfig(name="planner"), "Plan carefully."),
            ],
            "bob": [("bob", AgentConfig(name="private-agent"), "private")],
        }
    )
    reader = GatewayOwnerDataReader(_ThreadStore([]), _EventStore([]), _RunManager(), agent_store=store)

    page = await reader.list_agents(user_id="alice", limit=1, offset=0)

    assert store.list_call == {"user_id": "alice", "limit": 2, "offset": 0}
    assert page is not None
    assert page.agents == (
        {
            "name": "reviewer",
            "display_name": None,
            "description": "Reviews code",
            "model": None,
            "tool_groups": None,
            "skills": None,
            "allowed_subagents": None,
            "model_settings": None,
            "thinking_enabled": None,
            "reasoning_effort": None,
            "memory_enabled": True,
            "soul": "Review carefully.",
        },
    )
    assert "github" not in page.agents[0]
    assert page.has_more is True
    assert page.next_offset == 1


@pytest.mark.asyncio
async def test_agent_inventory_returns_unavailable_without_store():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    reader = GatewayOwnerDataReader(_ThreadStore([]), _EventStore([]), _RunManager())

    assert await reader.list_agents(user_id="alice", limit=10, offset=0) is None


@pytest.mark.asyncio
async def test_memory_inventory_uses_explicit_owner_and_projects_portable_fields():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    manager = _MemoryManager(
        {
            "version": "2.0",
            "revision": 12,
            "lastUpdated": "2026-09-20T12:00:00Z",
            "user": {"workContext": {"summary": "My work", "updatedAt": "today", "internal": "drop"}},
            "history": {},
            "facts": [
                {
                    "id": "fact-1",
                    "content": "Uses Python",
                    "category": "preference",
                    "confidence": 0.9,
                    "scope": {"userId": "alice", "agentName": "__default__"},
                    "revision": 7,
                    "credential": "drop",
                }
            ],
            "backend_secret": "drop",
        }
    )
    reader = GatewayOwnerDataReader(_ThreadStore([]), _EventStore([]), _RunManager(), memory_manager=manager)

    document = await reader.read_memory(user_id="alice")

    assert manager.read_users == ["alice"]
    assert document == {
        "version": "2.0",
        "lastUpdated": "2026-09-20T12:00:00Z",
        "user": {"workContext": {"summary": "My work", "updatedAt": "today"}},
        "facts": [
            {
                "id": "fact-1",
                "content": "Uses Python",
                "category": "preference",
                "confidence": 0.9,
            }
        ],
    }


@pytest.mark.asyncio
async def test_memory_inventory_fails_closed_when_backend_does_not_support_full_reads():
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    class UnsupportedManager:
        def get_memory(self, *, user_id: str | None = None):
            raise NotImplementedError

    reader = GatewayOwnerDataReader(_ThreadStore([]), _EventStore([]), _RunManager(), memory_manager=UnsupportedManager())

    assert await reader.read_memory(user_id="alice") is None


@pytest.mark.asyncio
async def test_file_export_reads_owner_workspace_files_but_skips_generated_and_sensitive_paths(tmp_path):
    import hashlib
    import os

    from app.gateway.owner_data_reader import GatewayOwnerDataReader
    from deerflow.config.paths import Paths

    paths = Paths(tmp_path / "deer-flow-home")
    paths.thread_dir("thread-a", user_id="alice")
    uploads = paths.sandbox_uploads_dir("thread-a", user_id="alice")
    outputs = paths.sandbox_outputs_dir("thread-a", user_id="alice")
    workspace = paths.sandbox_work_dir("thread-a", user_id="alice")
    uploads.mkdir(parents=True)
    outputs.mkdir(parents=True)
    workspace.mkdir(parents=True)
    (uploads / "brief.txt").write_bytes(b"my upload")
    (uploads / ".upload-part.part").write_bytes(b"staging")
    (outputs / "answer.txt").write_bytes(b"my output")
    guide = workspace / "docs" / "guide.md"
    guide.parent.mkdir()
    guide.write_bytes(b"workspace guide")
    (workspace / ".env").write_bytes(b"SECRET=do-not-export")
    (workspace / ".git").mkdir()
    (workspace / ".git" / "config").write_bytes(b"generated git metadata")
    outside_file = tmp_path / "outside-workspace-file.txt"
    outside_file.write_bytes(b"outside owner root")
    try:
        os.symlink(outside_file, workspace / "linked.txt")
    except (OSError, NotImplementedError):
        pass

    relpath = "project-a/documents/ab" + "a" * 64 + "/document-a"
    namespace = paths.project_document_path("alice", relpath)
    original = namespace / "original" / "source.txt"
    original.parent.mkdir(parents=True)
    original.write_bytes(b"project original")
    document_row = {
        "id": "document-a",
        "project_id": "project-a",
        "user_id": "alice",
        "name": "source.txt",
        "stored_relpath": relpath,
        "size_bytes": len(b"project original"),
        "sha256": hashlib.sha256(b"project original").hexdigest(),
        "trashed_at": None,
    }

    thread_store = _ThreadStore(
        [
            {"thread_id": "thread-a", "user_id": "alice"},
            {"thread_id": "thread-b", "user_id": "bob"},
        ]
    )
    foreign_upload = paths.sandbox_uploads_dir("thread-b", user_id="bob")
    foreign_upload.mkdir(parents=True)
    (foreign_upload / "foreign.txt").write_bytes(b"not alice")
    project_repository = _ProjectRepository(
        [
            {"id": "project-a", "user_id": "alice"},
            {"id": "project-b", "user_id": "bob"},
        ]
    )
    documents = _ProjectDocumentRepository([document_row, {**document_row, "id": "foreign-doc", "user_id": "bob"}])
    reader = GatewayOwnerDataReader(
        thread_store,
        _EventStore([]),
        _RunManager(),
        project_repository=project_repository,
        project_document_repository=documents,
        paths=paths,
    )

    result = await reader.read_files(user_id="alice", max_files=20, max_total_bytes=1_000)

    assert result is not None
    assert {(item.source, item.name) for item in result.files} == {
        ("thread_upload", "brief.txt"),
        ("thread_output", "answer.txt"),
        ("thread_workspace", "docs/guide.md"),
        ("project_document", "source.txt"),
    }
    assert {item.content for item in result.files} == {
        b"my upload",
        b"my output",
        b"workspace guide",
        b"project original",
    }
    assert all(b"SECRET=do-not-export" not in item.content for item in result.files)
    assert any("sensitive-looking workspace paths" in note.lower() for note in result.coverage_notes)
    assert all(item.thread_id in {None, "thread-a"} for item in result.files)
    assert all(item.project_id in {None, "project-a"} for item in result.files)
    assert documents.get_calls == [("document-a", "alice")]
    assert not result.truncated


@pytest.mark.asyncio
async def test_file_export_skips_oversized_items_and_symlinks(tmp_path):
    import os

    from app.gateway.owner_data_reader import GatewayOwnerDataReader
    from deerflow.config.paths import Paths

    paths = Paths(tmp_path / "deer-flow-home")
    uploads = paths.sandbox_uploads_dir("thread-a", user_id="alice")
    uploads.mkdir(parents=True)
    (uploads / "too-large.txt").write_bytes(b"this is too large")
    (uploads / "small.txt").write_bytes(b"ok")
    try:
        os.symlink(uploads / "too-large.txt", uploads / "linked.txt")
    except (OSError, NotImplementedError):
        pass
    reader = GatewayOwnerDataReader(
        _ThreadStore([{"thread_id": "thread-a", "user_id": "alice"}]),
        _EventStore([]),
        _RunManager(),
        project_repository=_ProjectRepository([]),
        project_document_repository=_ProjectDocumentRepository([]),
        paths=paths,
    )

    result = await reader.read_files(user_id="alice", max_files=10, max_total_bytes=2)

    assert result is not None
    assert [item.content for item in result.files] == [b"ok"]
    assert result.truncated


@pytest.mark.asyncio
async def test_file_export_reports_workspace_directory_scan_limit(tmp_path):
    from app.gateway.owner_data_reader import _MAX_FILE_WORKSPACE_DIRECTORIES, GatewayOwnerDataReader
    from deerflow.config.paths import Paths

    paths = Paths(tmp_path / "deer-flow-home")
    workspace = paths.sandbox_work_dir("thread-a", user_id="alice")
    workspace.mkdir(parents=True)
    (workspace / "README.md").write_bytes(b"kept workspace file")
    for index in range(_MAX_FILE_WORKSPACE_DIRECTORIES + 5):
        (workspace / f"directory-{index:03}").mkdir()

    reader = GatewayOwnerDataReader(
        _ThreadStore([{"thread_id": "thread-a", "user_id": "alice"}]),
        _EventStore([]),
        _RunManager(),
        project_repository=_ProjectRepository([]),
        project_document_repository=_ProjectDocumentRepository([]),
        paths=paths,
    )

    result = await reader.read_files(user_id="alice", max_files=10, max_total_bytes=1_000)

    assert result is not None
    assert [(item.source, item.name) for item in result.files] == [
        ("thread_workspace", "README.md"),
    ]
    assert result.truncated
    assert any("directory" in note.lower() and "limit" in note.lower() for note in result.coverage_notes)


@pytest.mark.asyncio
async def test_file_catalog_is_owner_scoped_and_searches_across_all_supported_sources(monkeypatch):
    from pathlib import Path

    from app.gateway import owner_data_reader as reader_module
    from app.gateway.owner_data_reader import GatewayOwnerDataReader

    def owned_directory(_paths, user_id: str, thread_id: str, source: str):
        return Path(f"{user_id}/{thread_id}/{source}")

    def file_metadata(directory: Path, _limit: int):
        key = (directory.parent.name, directory.name)
        entries = {
            ("thread-a", "thread_upload"): [{"name": "meeting-notes.txt", "size_bytes": 13, "modified": 1_790_000_000}],
            ("thread-a", "thread_output"): [{"name": "launch-summary.md", "size_bytes": 14, "modified": 1_790_000_001}],
        }
        return entries.get(key, []), False

    monkeypatch.setattr(
        GatewayOwnerDataReader,
        "_owned_thread_directory",
        staticmethod(owned_directory),
    )
    monkeypatch.setattr(reader_module, "_list_confined_regular_files", file_metadata)

    threads = _ThreadStore(
        [
            {
                "thread_id": "thread-a",
                "user_id": "alice",
                "display_name": "Launch planning",
                "project_id": "project-a",
            },
            {"thread_id": "foreign-thread", "user_id": "bob"},
        ]
    )
    projects = _ProjectRepository(
        [
            {"id": "project-a", "user_id": "alice", "name": "Launch"},
            {"id": "project-b", "user_id": "bob", "name": "Private"},
        ]
    )
    documents = _ProjectDocumentRepository(
        [
            {
                "id": "document-a",
                "project_id": "project-a",
                "user_id": "alice",
                "name": "launch-plan.pdf",
                "size_bytes": 12,
                "updated_at": "2026-09-01T00:00:00+00:00",
            },
            {
                "id": "foreign-document",
                "project_id": "project-b",
                "user_id": "bob",
                "name": "private.pdf",
                "size_bytes": 20,
            },
        ]
    )
    reader = GatewayOwnerDataReader(
        threads,
        _EventStore([]),
        _RunManager(),
        project_repository=projects,
        project_document_repository=documents,
        paths=object(),
    )

    first_page = await reader.list_files(user_id="alice", limit=2, offset=0)
    last_page = await reader.list_files(user_id="alice", limit=2, offset=2)
    search_results = await reader.list_files(user_id="alice", limit=10, offset=0, query="launch-plan")
    title_search = await reader.list_files(user_id="alice", limit=10, offset=0, query="planning")
    project_name_search = await reader.list_files(user_id="alice", limit=10, offset=0, query="launch")

    assert first_page.total == 3
    assert len(first_page.files) == 2
    assert first_page.has_more is True
    assert first_page.next_offset == 2
    assert last_page.total == 3
    assert len(last_page.files) == 1
    assert last_page.has_more is False
    assert {(item.source, item.name) for item in search_results.files} == {
        ("project_document", "launch-plan.pdf"),
    }
    assert {(item.source, item.name) for item in title_search.files} == {
        ("thread_upload", "meeting-notes.txt"),
        ("thread_output", "launch-summary.md"),
    }
    assert {(item.source, item.name) for item in project_name_search.files} == {
        ("thread_upload", "meeting-notes.txt"),
        ("thread_output", "launch-summary.md"),
        ("project_document", "launch-plan.pdf"),
    }
    assert all(item.thread_id != "foreign-thread" for item in first_page.files)
    assert all(item.name != "private.pdf" for item in search_results.files)
    assert next(item.artifact_url for item in search_results.files if item.source == "project_document") == "/api/projects/project-a/documents/document-a/content?download=true"
    assert all(not hasattr(item, "content") for item in first_page.files)


@pytest.mark.asyncio
async def test_file_catalog_caps_workspace_directory_walks_for_the_entire_scan(monkeypatch, tmp_path):
    from pathlib import Path

    from app.gateway import owner_data_reader as reader_module
    from app.gateway.owner_data_reader import _MAX_FILE_WORKSPACE_SCAN_DIRECTORIES, GatewayOwnerDataReader
    from deerflow.config.paths import Paths

    workspace_limits: list[int] = []

    def owned_directory(_paths, user_id: str, thread_id: str, source: str):
        return Path(f"{user_id}/{thread_id}/{source}")

    def regular_files(_directory: Path, _limit: int):
        return [], False

    def workspace_files(_directory: Path, _limit: int, directory_limit: int = 200):
        workspace_limits.append(directory_limit)
        return [], True, 0, directory_limit

    monkeypatch.setattr(
        GatewayOwnerDataReader,
        "_owned_thread_directory",
        staticmethod(owned_directory),
    )
    monkeypatch.setattr(reader_module, "_list_confined_regular_files", regular_files)
    monkeypatch.setattr(reader_module, "_list_confined_workspace_files", workspace_files)
    threads = _ThreadStore([{"thread_id": f"thread-{index}", "user_id": "alice"} for index in range(101)])
    reader = GatewayOwnerDataReader(
        threads,
        _EventStore([]),
        _RunManager(),
        project_repository=_ProjectRepository([]),
        project_document_repository=_ProjectDocumentRepository([]),
        paths=Paths(tmp_path / "deer-flow-home"),
    )

    page = await reader.list_files(user_id="alice", limit=10_000, offset=0)

    assert page is not None
    assert page.truncated
    assert sum(workspace_limits) == _MAX_FILE_WORKSPACE_SCAN_DIRECTORIES
    assert len(workspace_limits) == _MAX_FILE_WORKSPACE_SCAN_DIRECTORIES // 200
    assert any("scan limit" in note.lower() for note in page.coverage_notes)


@pytest.mark.asyncio
async def test_file_catalog_includes_owner_workspace_files_and_skips_generated_dirs_and_symlinks(tmp_path):
    import os

    from app.gateway.owner_data_reader import GatewayOwnerDataReader
    from deerflow.config.paths import Paths

    paths = Paths(tmp_path / "deer-flow-home")
    workspace = paths.sandbox_work_dir("thread-a", user_id="alice")
    guide = workspace / "docs" / "guide.md"
    guide.parent.mkdir(parents=True)
    guide.write_text("user-owned workspace file", encoding="utf-8")
    (workspace / ".git").mkdir()
    (workspace / ".git" / "config").write_text("git metadata", encoding="utf-8")
    (workspace / "node_modules").mkdir()
    (workspace / "node_modules" / "package.js").write_text("generated", encoding="utf-8")
    outside = tmp_path / "outside.txt"
    outside.write_text("outside the owner root", encoding="utf-8")
    try:
        os.symlink(outside, workspace / "linked.txt")
    except (OSError, NotImplementedError):
        pass
    outside_directory = tmp_path / "outside-directory"
    outside_directory.mkdir()
    (outside_directory / "private.md").write_text("outside directory", encoding="utf-8")
    try:
        os.symlink(outside_directory, workspace / "linked-directory", target_is_directory=True)
    except (OSError, NotImplementedError):
        pass

    reader = GatewayOwnerDataReader(
        _ThreadStore(
            [
                {
                    "thread_id": "thread-a",
                    "user_id": "alice",
                    "display_name": "Workspace conversation",
                },
                {"thread_id": "foreign-thread", "user_id": "bob"},
            ]
        ),
        _EventStore([]),
        _RunManager(),
        project_repository=_ProjectRepository([]),
        project_document_repository=_ProjectDocumentRepository([]),
        paths=paths,
    )

    # Empty search verifies the entire owner catalog skips generated trees and links.
    page = await reader.list_files(user_id="alice", limit=50, offset=0)

    assert page is not None
    assert len(page.files) == 1
    entry = page.files[0]
    assert entry.source == "thread_workspace"
    assert entry.name == "docs/guide.md"
    assert entry.storage_name == "docs/guide.md"
    assert entry.thread_id == "thread-a"
    assert entry.thread_name == "Workspace conversation"
    assert entry.artifact_url.endswith("/api/threads/thread-a/artifacts/mnt/user-data/workspace/docs/guide.md")
    assert not page.truncated
