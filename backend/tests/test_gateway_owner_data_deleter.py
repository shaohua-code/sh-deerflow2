"""Gateway 向可信产品扩展授予的窄范围删除能力。"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC
from types import SimpleNamespace

import pytest

from app.gateway.owner_data_deleter import GatewayOwnerDataDeleter
from deerflow.runtime import ThreadOperationKind
from deerflow.runtime.runs.manager import ConflictError


@pytest.mark.asyncio
async def test_deleter_rechecks_owner_and_delegates_one_task() -> None:
    class _Repository:
        def __init__(self) -> None:
            self.call = None

        async def delete_with_queue_cancellation(self, task_id, **kwargs):
            self.call = (task_id, kwargs)
            return "deleted"

    repository = _Repository()
    deleter = GatewayOwnerDataDeleter(scheduled_task_repository=repository)

    result = await deleter.delete_scheduled_task(user_id="user-a", task_id="task-a")

    assert result == "deleted"
    assert repository.call is not None
    task_id, kwargs = repository.call
    assert task_id == "task-a"
    assert kwargs["user_id"] == "user-a"
    assert kwargs["error"] == "scheduled task definition deleted by its owner"
    assert kwargs["now"].tzinfo is UTC


@pytest.mark.asyncio
async def test_deleter_is_unavailable_without_gateway_repository() -> None:
    deleter = GatewayOwnerDataDeleter(scheduled_task_repository=None)

    assert await deleter.delete_scheduled_task(user_id="user-a", task_id="task-a") is None


@pytest.mark.asyncio
async def test_memory_deleter_clears_only_the_explicit_owner() -> None:
    calls = []

    class MemoryManager:
        def clear_memory(self, *, user_id: str):
            calls.append(user_id)
            return {"facts": []}

    deleter = GatewayOwnerDataDeleter(
        scheduled_task_repository=None,
        memory_manager=MemoryManager(),
    )

    assert deleter.supports_memory_clear is True
    assert await deleter.delete_memory(user_id="user-a") == "deleted"
    assert calls == ["user-a"]


@pytest.mark.asyncio
async def test_memory_deleter_fails_closed_when_backend_cannot_clear() -> None:
    deleter = GatewayOwnerDataDeleter(
        scheduled_task_repository=None,
        memory_manager=object(),
    )

    assert deleter.supports_memory_clear is False
    assert await deleter.delete_memory(user_id="user-a") is None
    with pytest.raises(ValueError):
        await deleter.delete_memory(user_id="u" * 256)


@pytest.mark.asyncio
async def test_deleter_deletes_only_the_explicit_owner_agent(monkeypatch) -> None:
    calls = []

    def delete(store, name, user_id):
        calls.append((store, name, user_id))
        return "deleted"

    monkeypatch.setattr("app.gateway.agent_deletion.delete_agent_with_memory_cancel", delete)
    store = object()
    deleter = GatewayOwnerDataDeleter(
        scheduled_task_repository=None,
        agent_store=store,
    )

    assert await deleter.delete_agent(user_id="user-a", name="My-Agent") == "deleted"
    assert calls == [(store, "my-agent", "user-a")]


@pytest.mark.asyncio
async def test_agent_deletion_is_unavailable_or_rejects_invalid_inputs(monkeypatch) -> None:
    unavailable = GatewayOwnerDataDeleter(scheduled_task_repository=None)
    assert await unavailable.delete_agent(user_id="user-a", name="agent") is None

    deleter = GatewayOwnerDataDeleter(
        scheduled_task_repository=None,
        agent_store=object(),
    )
    with pytest.raises(ValueError):
        await deleter.delete_agent(user_id="user-a", name="../shared")


@pytest.mark.asyncio
async def test_custom_skill_purge_uses_explicit_owner_and_refreshes_only_that_owner(monkeypatch) -> None:
    calls = []

    class Storage:
        user_id = "user-a"

        def purge_custom_skills(self):
            calls.append(("purge", self.user_id))
            return 2

    monkeypatch.setattr("deerflow.skills.storage.get_or_new_user_skill_storage", lambda user_id: Storage())

    async def refresh(user_id):
        calls.append(("refresh", user_id))

    monkeypatch.setattr("deerflow.agents.lead_agent.prompt.refresh_user_skills_system_prompt_cache_async", refresh)
    deleter = GatewayOwnerDataDeleter(scheduled_task_repository=None)

    assert deleter.supports_custom_skills_delete is True
    assert await deleter.delete_custom_skills(user_id="user-a") == "deleted"
    assert calls == [("purge", "user-a"), ("refresh", "user-a")]


@pytest.mark.asyncio
async def test_custom_skill_purge_fails_closed_without_storage_capability(monkeypatch) -> None:
    monkeypatch.setattr("deerflow.skills.storage.get_or_new_user_skill_storage", lambda _user_id: object())
    deleter = GatewayOwnerDataDeleter(scheduled_task_repository=None)

    assert await deleter.delete_custom_skills(user_id="user-a") is None
    with pytest.raises(ValueError):
        await deleter.delete_custom_skills(user_id="u" * 256)


@pytest.mark.asyncio
async def test_thread_deleter_rechecks_owner_and_uses_durable_reservation(monkeypatch) -> None:
    calls = []

    class ThreadStore:
        async def get(self, thread_id, *, user_id):
            calls.append(("get", thread_id, user_id))
            return {"thread_id": thread_id, "user_id": "user-a"}

    class RunManager:
        @asynccontextmanager
        async def reserve_thread_operation(self, thread_id, *, kind, user_id):
            calls.append(("reserve", thread_id, kind, user_id))
            yield

    app = SimpleNamespace(state=SimpleNamespace(thread_store=ThreadStore(), run_manager=RunManager()))

    async def delete_history(thread_id, request, *, user_id):
        calls.append(("delete", thread_id, request.app is app, user_id))

    monkeypatch.setattr("app.gateway.routers.threads._delete_thread_data_with_reservation", delete_history)
    deleter = GatewayOwnerDataDeleter(scheduled_task_repository=None, app=app)

    outcome = await deleter.delete_thread(user_id="user-a", thread_id="thread-a")

    assert outcome == "deleted"
    assert calls == [
        ("get", "thread-a", "user-a"),
        ("reserve", "thread-a", ThreadOperationKind.delete, "user-a"),
        ("delete", "thread-a", True, "user-a"),
    ]


@pytest.mark.asyncio
async def test_thread_deleter_fails_closed_for_foreign_threads_and_maps_busy() -> None:
    class ThreadStore:
        async def get(self, thread_id, *, user_id):
            return {"thread_id": thread_id, "user_id": "user-b"}

    app = SimpleNamespace(state=SimpleNamespace(thread_store=ThreadStore()))
    deleter = GatewayOwnerDataDeleter(scheduled_task_repository=None, app=app)

    assert await deleter.delete_thread(user_id="user-a", thread_id="thread-a") == "not_found"

    class BusyRunManager:
        @asynccontextmanager
        async def reserve_thread_operation(self, _thread_id, *, kind, user_id):
            raise ConflictError("thread has active work")
            yield  # pragma: no cover - required by asynccontextmanager

    app.state.thread_store = SimpleNamespace(get=lambda thread_id, *, user_id: _owned_thread(thread_id, user_id))
    app.state.run_manager = BusyRunManager()
    assert await deleter.delete_thread(user_id="user-a", thread_id="thread-a") == "executing"


async def _owned_thread(thread_id: str, user_id: str) -> dict[str, str]:
    return {"thread_id": thread_id, "user_id": user_id}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("user_id", "task_id"),
    [("", "task-a"), ("u" * 256, "task-a"), ("user-a", ""), ("user-a", "t" * 65)],
)
async def test_deleter_rejects_malformed_owner_and_id(user_id: str, task_id: str) -> None:
    deleter = GatewayOwnerDataDeleter(scheduled_task_repository=object())

    with pytest.raises(ValueError):
        await deleter.delete_scheduled_task(user_id=user_id, task_id=task_id)


@pytest.mark.asyncio
async def test_project_deleter_passes_explicit_owner_and_audits_project_deletion(monkeypatch) -> None:
    class _ProjectRepository:
        def __init__(self) -> None:
            self.calls = []

        async def delete(self, project_id: str, *, user_id: str) -> bool:
            self.calls.append((project_id, user_id))
            return project_id == "project-owned"

    repository = _ProjectRepository()
    app = SimpleNamespace(state=SimpleNamespace())
    audit_calls = []

    async def record_audit(request, **kwargs):
        audit_calls.append((request.app is app, kwargs))

    monkeypatch.setattr("app.gateway.action_audit.notify_action_audit", record_audit)
    deleter = GatewayOwnerDataDeleter(
        scheduled_task_repository=None,
        project_repository=repository,
        app=app,
    )

    assert deleter.supports_project_delete is True
    assert await deleter.delete_project(user_id="user-a", project_id="project-owned") == "deleted"
    assert await deleter.delete_project(user_id="user-a", project_id="project-foreign") == "not_found"
    assert repository.calls == [
        ("project-owned", "user-a"),
        ("project-foreign", "user-a"),
    ]
    assert audit_calls == [
        (
            True,
            {
                "action": "project.delete",
                "resource_type": "project",
                "resource_id": "project-owned",
                "actor_user_id": "user-a",
            },
        )
    ]


@pytest.mark.asyncio
async def test_file_deleter_owner_checks_upload_and_omits_filename_from_audit(monkeypatch) -> None:
    calls = []
    audit_calls = []

    class ThreadStore:
        async def get(self, thread_id: str, *, user_id: str):
            calls.append(("owner-check", thread_id, user_id))
            return {"thread_id": thread_id, "user_id": user_id}

    app = SimpleNamespace(state=SimpleNamespace(thread_store=ThreadStore()))

    def delete_upload(thread_id: str, filename: str, user_id: str):
        calls.append(("delete", thread_id, filename, user_id))
        return {"success": True}

    async def record_audit(request, **kwargs):
        audit_calls.append((request.app is app, kwargs))

    monkeypatch.setattr(
        "app.gateway.routers.uploads._delete_uploaded_file_for_thread",
        delete_upload,
    )
    monkeypatch.setattr("app.gateway.action_audit.notify_action_audit", record_audit)
    deleter = GatewayOwnerDataDeleter(scheduled_task_repository=None, app=app)

    assert deleter.supports_file_delete is True
    assert (
        await deleter.delete_file(
            user_id="user-a",
            file_id="thread_upload:thread-a:private-notes.txt",
        )
        == "deleted"
    )
    assert calls == [
        ("owner-check", "thread-a", "user-a"),
        ("delete", "thread-a", "private-notes.txt", "user-a"),
    ]
    assert audit_calls == [
        (
            True,
            {
                "action": "upload.delete",
                "resource_type": "thread_upload",
                "resource_id": "thread-a",
                "actor_user_id": "user-a",
            },
        )
    ]


@pytest.mark.asyncio
async def test_file_deleter_moves_owned_project_document_to_trash(monkeypatch) -> None:
    calls = []
    audit_calls = []

    class ProjectDocumentRepository:
        async def trash(self, document_id: str, *, project_id: str, user_id: str):
            calls.append((document_id, project_id, user_id))
            return document_id == "document-a"

    app = SimpleNamespace(state=SimpleNamespace())

    async def record_audit(request, **kwargs):
        audit_calls.append((request.app is app, kwargs))

    monkeypatch.setattr("app.gateway.action_audit.notify_action_audit", record_audit)
    deleter = GatewayOwnerDataDeleter(
        scheduled_task_repository=None,
        project_document_repository=ProjectDocumentRepository(),
        app=app,
    )

    assert (
        await deleter.delete_file(
            user_id="user-a",
            file_id="project-document:project-a:document-a",
        )
        == "trashed"
    )
    assert (
        await deleter.delete_file(
            user_id="user-a",
            file_id="project-document:project-b:document-foreign",
        )
        == "not_found"
    )
    assert calls == [
        ("document-a", "project-a", "user-a"),
        ("document-foreign", "project-b", "user-a"),
    ]
    assert audit_calls == [
        (
            True,
            {
                "action": "project.document.trash",
                "resource_type": "project_document",
                "resource_id": "document-a",
                "actor_user_id": "user-a",
            },
        )
    ]


@pytest.mark.asyncio
async def test_file_deleter_rejects_paths_and_keeps_read_only_files() -> None:
    app = SimpleNamespace(state=SimpleNamespace(thread_store=SimpleNamespace()))
    deleter = GatewayOwnerDataDeleter(scheduled_task_repository=None, app=app)

    assert (
        await deleter.delete_file(
            user_id="user-a",
            file_id="thread_upload:thread-a:..\\outside.txt",
        )
        == "invalid"
    )
    assert (
        await deleter.delete_file(
            user_id="user-a",
            file_id="thread_output:thread-a:report.html",
        )
        == "unsupported"
    )
    assert (
        await deleter.delete_file(
            user_id="user-a",
            file_id="thread_workspace:thread-a:notes.md",
        )
        == "unsupported"
    )
    with pytest.raises(ValueError):
        await deleter.delete_file(user_id="", file_id="thread_upload:thread-a:file.txt")


@pytest.mark.asyncio
async def test_project_deletion_is_unavailable_and_rejects_invalid_owner_or_id() -> None:
    deleter = GatewayOwnerDataDeleter(scheduled_task_repository=None)
    assert deleter.supports_project_delete is False
    assert await deleter.delete_project(user_id="user-a", project_id="project-a") is None

    class _LegacyProjectRepository:
        async def delete(self, project_id: str) -> bool:
            return True

    legacy = GatewayOwnerDataDeleter(
        scheduled_task_repository=None,
        project_repository=_LegacyProjectRepository(),
    )
    assert legacy.supports_project_delete is False
    assert await legacy.delete_project(user_id="user-a", project_id="project-a") is None

    with pytest.raises(ValueError):
        await deleter.delete_project(user_id="", project_id="project-a")
    with pytest.raises(ValueError):
        await deleter.delete_project(user_id="user-a", project_id="")
