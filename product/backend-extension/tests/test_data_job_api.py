"""数据任务 API 的身份、幂等与范围校验测试。"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from deerflow_extension_api import (
    EXTENSION_DATA_SCOPE_CHECKER_KEY,
    EXTENSION_PRINCIPAL_RESOLVER_KEY,
    ExtensionDataScopeError,
    ExtensionPrincipal,
    ExtensionRuntimeDeps,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient
from flow_desk_product_extension.api import _data_job_artifact_filename, build_router
from flow_desk_product_extension.settings import ProductSettingsStore
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

_DATA_JOB_PERMISSIONS = (
    "preferences:read",
    "preferences:write",
    "threads:read",
    "threads:delete",
    "runs:read",
    "projects:read",
    "projects:delete",
    "agents:read",
    "agents:delete",
    "memory:read",
    "memory:delete",
)


def _resolve_test_principal(request):
    user_id = request.headers.get("x-test-user")
    if not user_id:
        return None
    requested_permissions = request.headers.get("x-test-permissions")
    if requested_permissions is None:
        permissions = _DATA_JOB_PERMISSIONS
    elif requested_permissions:
        permissions = tuple(requested_permissions.split(","))
    else:
        permissions = ()
    return ExtensionPrincipal(user_id=user_id, permissions=permissions)


async def _allow_test_data_scope(_request, **_kwargs) -> None:
    """Simulate Gateway's no-Central-IAM pass-through for local-RBAC tests."""


class _AllowOwnerDataAuthorizer:
    async def authorize(self, *, user_id: str, scopes) -> None:
        assert user_id
        assert scopes


def _install_test_scope_checker(app: FastAPI) -> None:
    setattr(app.state, EXTENSION_DATA_SCOPE_CHECKER_KEY, _allow_test_data_scope)


def test_data_job_artifact_filename_matches_each_export_scope() -> None:
    job_id = "00000000-0000-4000-8000-000000000000"

    assert _data_job_artifact_filename(["preferences"], job_id) == (
        f"flow-desk-preferences-{job_id}.json"
    )
    assert _data_job_artifact_filename(["threads"], job_id) == (
        f"flow-desk-conversations-partial-{job_id}.json"
    )
    assert _data_job_artifact_filename(["files"], job_id) == (
        f"flow-desk-files-partial-{job_id}.json"
    )
    assert _data_job_artifact_filename(["account"], job_id) == (
        f"flow-desk-account-export-partial-{job_id}.zip"
    )
    # 历史库中的未知 scope 不能被误导性地命名为偏好导出。
    assert _data_job_artifact_filename(["future_scope"], job_id) == (
        f"flow-desk-export-{job_id}.json"
    )


def test_data_job_routes_are_closed_until_operator_enables_them() -> None:
    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        lambda _request: ExtensionPrincipal(user_id="user-a"),
    )
    app.include_router(build_router({}, ProductSettingsStore()))

    response = TestClient(app).post(
        "/api/product/v1/data-exports",
        headers={"Idempotency-Key": "disabled-route"},
        json={"scope": ["preferences"]},
    )

    assert response.status_code == 404


def test_data_job_creation_requires_every_scope_permission_before_storage_access() -> None:
    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(app.state, EXTENSION_PRINCIPAL_RESOLVER_KEY, _resolve_test_principal)
    app.include_router(build_router({"data_jobs": {"enabled": True}}, None))

    cases = [
        (
            "/api/product/v1/data-exports",
            {"scope": ["threads"]},
            ("threads:read",),  # Thread exports also contain run usage summaries.
        ),
        (
            "/api/product/v1/data-exports",
            {"scope": ["account"]},
            tuple(
                permission for permission in _DATA_JOB_PERMISSIONS if permission != "memory:read"
            ),
        ),
        (
            "/api/product/v1/data-deletions",
            {"scope": ["files"], "confirmation": "DELETE MY FILES"},
            ("threads:delete",),  # File deletion also touches project documents.
        ),
    ]

    with TestClient(app) as client:
        for index, (path, body, permissions) in enumerate(cases):
            response = client.post(
                path,
                headers={
                    "x-test-user": f"user-{index}",
                    "x-test-permissions": ",".join(permissions),
                    "Idempotency-Key": f"denied-scope-{index}",
                },
                json=body,
            )
            # Missing grants must be reported before the unavailable storage.
            assert response.status_code == 403


def test_central_data_scope_denial_precedes_storage_and_checks_each_file_source() -> None:
    calls: list[tuple[str, str]] = []

    async def deny_project_delete(_request, *, target, action, resource_id):
        assert resource_id is None
        calls.append((target, action))
        if target == "projects:delete":
            raise ExtensionDataScopeError(403, "Permission denied by Central IAM data scope")

    app = FastAPI()
    setattr(app.state, EXTENSION_PRINCIPAL_RESOLVER_KEY, _resolve_test_principal)
    setattr(app.state, EXTENSION_DATA_SCOPE_CHECKER_KEY, deny_project_delete)
    app.include_router(build_router({"data_jobs": {"enabled": True}}, None))

    response = TestClient(app).post(
        "/api/product/v1/data-deletions",
        headers={"x-test-user": "user-a", "Idempotency-Key": "iam-file-delete"},
        json={"scope": ["files"], "confirmation": "DELETE MY FILES"},
    )

    assert response.status_code == 403
    assert calls == [("threads:delete", "delete"), ("projects:delete", "delete")]


def test_thread_history_deletion_requires_capability_and_exact_confirmation(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-thread-delete-api.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    asyncio.run(store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine))))
    store._owner_data_reader = SimpleNamespace(list_threads=lambda **_kwargs: None)
    store._owner_data_deleter = SimpleNamespace(delete_thread=lambda **_kwargs: None)
    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        _resolve_test_principal,
    )
    app.include_router(build_router({"data_jobs": {"enabled": True}}, store))

    try:
        with TestClient(app) as client:
            accepted = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-a", "Idempotency-Key": "threads-delete-a"},
                json={"scope": ["threads"], "confirmation": "DELETE THREAD HISTORY"},
            )
            assert accepted.status_code == 202
            assert accepted.json()["job"]["scope"] == ["threads"]

            wrong_phrase = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-b", "Idempotency-Key": "threads-delete-b"},
                json={"scope": ["threads"], "confirmation": "DELETE PREFERENCES"},
            )
            assert wrong_phrase.status_code == 422

            store._owner_data_deleter = None
            unavailable = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-c", "Idempotency-Key": "threads-delete-c"},
                json={"scope": ["threads"], "confirmation": "DELETE THREAD HISTORY"},
            )
            assert unavailable.status_code == 503
    finally:
        asyncio.run(engine.dispose())


def test_file_deletion_requires_gateway_capabilities_and_exact_confirmation(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-file-delete-api.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    asyncio.run(store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine))))
    store._owner_data_reader = SimpleNamespace(list_files=lambda **_kwargs: None)
    store._owner_data_deleter = SimpleNamespace(
        supports_file_delete=True,
        delete_file=lambda **_kwargs: "deleted",
    )
    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        _resolve_test_principal,
    )
    app.include_router(build_router({"data_jobs": {"enabled": True}}, store))

    try:
        with TestClient(app) as client:
            accepted = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-a", "Idempotency-Key": "files-delete-a"},
                json={"scope": ["files"], "confirmation": "DELETE MY FILES"},
            )
            assert accepted.status_code == 202
            assert accepted.json()["job"]["scope"] == ["files"]

            wrong_phrase = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-b", "Idempotency-Key": "files-delete-b"},
                json={"scope": ["files"], "confirmation": "DELETE PREFERENCES"},
            )
            assert wrong_phrase.status_code == 422

            store._owner_data_deleter.supports_file_delete = False
            unavailable = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-c", "Idempotency-Key": "files-delete-c"},
                json={"scope": ["files"], "confirmation": "DELETE MY FILES"},
            )
            assert unavailable.status_code == 503
    finally:
        asyncio.run(store.stop())
        asyncio.run(engine.dispose())


def test_memory_deletion_requires_a_supported_backend_and_exact_confirmation(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-memory-delete-api.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    asyncio.run(store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine))))
    store._owner_data_deleter = SimpleNamespace(
        supports_memory_clear=True,
        delete_memory=lambda **_kwargs: "deleted",
    )
    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        _resolve_test_principal,
    )
    app.include_router(build_router({"data_jobs": {"enabled": True}}, store))

    try:
        with TestClient(app) as client:
            accepted = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-a", "Idempotency-Key": "memory-delete-a"},
                json={"scope": ["memory"], "confirmation": "DELETE MY MEMORY"},
            )
            assert accepted.status_code == 202
            assert accepted.json()["job"]["scope"] == ["memory"]

            wrong_phrase = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-b", "Idempotency-Key": "memory-delete-b"},
                json={"scope": ["memory"], "confirmation": "DELETE PREFERENCES"},
            )
            assert wrong_phrase.status_code == 422

            store._owner_data_deleter.supports_memory_clear = False
            unavailable = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-c", "Idempotency-Key": "memory-delete-c"},
                json={"scope": ["memory"], "confirmation": "DELETE MY MEMORY"},
            )
            assert unavailable.status_code == 503
    finally:
        asyncio.run(engine.dispose())


def test_project_deletion_requires_gateway_capability_and_exact_confirmation(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-project-delete-api.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    asyncio.run(store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine))))
    store._owner_data_reader = SimpleNamespace(list_projects=lambda **_kwargs: None)
    store._owner_data_deleter = SimpleNamespace(
        supports_project_delete=True,
        delete_project=lambda **_kwargs: "deleted",
    )
    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        _resolve_test_principal,
    )
    app.include_router(build_router({"data_jobs": {"enabled": True}}, store))

    try:
        with TestClient(app) as client:
            accepted = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-a", "Idempotency-Key": "projects-delete-a"},
                json={"scope": ["projects"], "confirmation": "DELETE MY PROJECTS"},
            )
            assert accepted.status_code == 202
            assert accepted.json()["job"]["scope"] == ["projects"]

            wrong_phrase = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-b", "Idempotency-Key": "projects-delete-b"},
                json={"scope": ["projects"], "confirmation": "DELETE PREFERENCES"},
            )
            assert wrong_phrase.status_code == 422

            store._owner_data_deleter.supports_project_delete = False
            unavailable = client.post(
                "/api/product/v1/data-deletions",
                headers={"x-test-user": "user-c", "Idempotency-Key": "projects-delete-c"},
                json={"scope": ["projects"], "confirmation": "DELETE MY PROJECTS"},
            )
            assert unavailable.status_code == 503
    finally:
        asyncio.run(engine.dispose())


def test_data_job_routes_scope_every_operation_to_the_resolved_owner(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-job-api.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    asyncio.run(store.start(ExtensionRuntimeDeps(session_factory=async_sessionmaker(engine))))
    # 模拟 Gateway 显式提供的 owner 清单与窄范围删除能力。
    store._owner_data_reader = SimpleNamespace(
        list_scheduled_tasks=lambda **_kwargs: None,
        list_agents=lambda **_kwargs: None,
    )
    store._owner_data_deleter = SimpleNamespace(
        delete_scheduled_task=lambda **_kwargs: None,
        delete_agent=lambda **_kwargs: None,
    )
    app = FastAPI()
    _install_test_scope_checker(app)

    def resolve_test_principal(request):
        return _resolve_test_principal(request)

    setattr(app.state, EXTENSION_PRINCIPAL_RESOLVER_KEY, resolve_test_principal)
    app.include_router(build_router({"data_jobs": {"enabled": True}}, store))

    try:
        with TestClient(app) as client:
            owner_headers = {
                "x-test-user": "user-a",
                "Idempotency-Key": "preferences-export-api-1",
            }
            created = client.post(
                "/api/product/v1/data-exports",
                headers=owner_headers,
                json={"scope": ["preferences"]},
            )
            assert created.status_code == 202
            job = created.json()["job"]
            assert job["status"] == "queued"

            repeated = client.post(
                "/api/product/v1/data-exports",
                headers=owner_headers,
                json={"scope": ["preferences"]},
            )
            assert repeated.json()["job"]["job_id"] == job["job_id"]
            active_conflict = client.post(
                "/api/product/v1/data-exports",
                headers={**owner_headers, "Idempotency-Key": "second-active-request"},
                json={"scope": ["preferences"]},
            )
            assert active_conflict.status_code == 409

            # 其他用户不能通过已知 ID 查询、取消或下载任务。
            other_headers = {"x-test-user": "user-b"}
            assert (
                client.get(
                    f"/api/product/v1/data-jobs/{job['job_id']}",
                    headers=other_headers,
                ).status_code
                == 404
            )
            assert (
                client.post(
                    f"/api/product/v1/data-jobs/{job['job_id']}/cancel",
                    headers=other_headers,
                ).status_code
                == 404
            )
            assert (
                client.get(
                    f"/api/product/v1/data-jobs/{job['job_id']}/artifact",
                    headers=other_headers,
                ).status_code
                == 404
            )
            revoked_headers = {
                "x-test-user": "user-a",
                "x-test-permissions": "",
            }
            assert (
                client.get(
                    f"/api/product/v1/data-jobs/{job['job_id']}",
                    headers=revoked_headers,
                ).status_code
                == 403
            )
            assert (
                client.post(
                    f"/api/product/v1/data-jobs/{job['job_id']}/cancel",
                    headers=revoked_headers,
                ).status_code
                == 403
            )
            assert (
                client.get(
                    "/api/product/v1/data-jobs",
                    headers=other_headers,
                ).json()["jobs"]
                == []
            )
            assert (
                client.get(
                    f"/api/product/v1/data-jobs/{job['job_id']}/artifact",
                    headers=owner_headers,
                ).status_code
                == 409
            )

            # 会话范围只开放导出；删除接口必须继续拒绝 threads。
            thread_export = client.post(
                "/api/product/v1/data-exports",
                headers={"x-test-user": "user-c", "Idempotency-Key": "threads-export"},
                json={"scope": ["threads"]},
            )
            assert thread_export.status_code == 202
            assert thread_export.json()["job"]["scope"] == ["threads"]
            project_export = client.post(
                "/api/product/v1/data-exports",
                headers={
                    "x-test-user": "user-d",
                    "Idempotency-Key": "projects-export",
                },
                json={"scope": ["projects"]},
            )
            assert project_export.status_code == 202
            assert project_export.json()["job"]["scope"] == ["projects"]
            scheduled_task_export = client.post(
                "/api/product/v1/data-exports",
                headers={
                    "x-test-user": "user-e",
                    "Idempotency-Key": "scheduled-tasks-export",
                },
                json={"scope": ["scheduled_tasks"]},
            )
            assert scheduled_task_export.status_code == 202
            assert scheduled_task_export.json()["job"]["scope"] == ["scheduled_tasks"]
            agent_export = client.post(
                "/api/product/v1/data-exports",
                headers={"x-test-user": "user-f", "Idempotency-Key": "agents-export"},
                json={"scope": ["agents"]},
            )
            assert agent_export.status_code == 202
            assert agent_export.json()["job"]["scope"] == ["agents"]
            memory_export = client.post(
                "/api/product/v1/data-exports",
                headers={"x-test-user": "user-g", "Idempotency-Key": "memory-export"},
                json={"scope": ["memory"]},
            )
            assert memory_export.status_code == 202
            assert memory_export.json()["job"]["scope"] == ["memory"]
            files_export = client.post(
                "/api/product/v1/data-exports",
                headers={"x-test-user": "user-h", "Idempotency-Key": "files-export"},
                json={"scope": ["files"]},
            )
            assert files_export.status_code == 202
            assert files_export.json()["job"]["scope"] == ["files"]
            account_export = client.post(
                "/api/product/v1/data-exports",
                headers={
                    "x-test-user": "user-account",
                    "Idempotency-Key": "account-export",
                },
                json={"scope": ["account"]},
            )
            assert account_export.status_code == 202
            assert account_export.json()["job"]["scope"] == ["account"]
            assert (
                client.post(
                    "/api/product/v1/data-deletions",
                    headers={
                        "x-test-user": "user-c",
                        "Idempotency-Key": "threads-delete",
                    },
                    json={"scope": ["threads"], "confirmation": "DELETE PREFERENCES"},
                ).status_code
                == 422
            )
            scheduled_task_deletion = client.post(
                "/api/product/v1/data-deletions",
                headers={
                    "x-test-user": "user-i",
                    "Idempotency-Key": "scheduled-tasks-delete-valid",
                },
                json={
                    "scope": ["scheduled_tasks"],
                    "confirmation": "DELETE SCHEDULED TASKS",
                },
            )
            assert scheduled_task_deletion.status_code == 202
            assert scheduled_task_deletion.json()["job"]["scope"] == ["scheduled_tasks"]

            agent_deletion = client.post(
                "/api/product/v1/data-deletions",
                headers={
                    "x-test-user": "user-k",
                    "Idempotency-Key": "custom-agents-delete-valid",
                },
                json={"scope": ["agents"], "confirmation": "DELETE CUSTOM AGENTS"},
            )
            assert agent_deletion.status_code == 202
            assert agent_deletion.json()["job"]["scope"] == ["agents"]

            # 兼容尚未授予删除 capability 的旧 Gateway：失败关闭，不排队假任务。
            store._owner_data_deleter = None
            unavailable_deletion = client.post(
                "/api/product/v1/data-deletions",
                headers={
                    "x-test-user": "user-j",
                    "Idempotency-Key": "scheduled-tasks-delete-unavailable",
                },
                json={
                    "scope": ["scheduled_tasks"],
                    "confirmation": "DELETE SCHEDULED TASKS",
                },
            )
            assert unavailable_deletion.status_code == 503
            unavailable_agent_deletion = client.post(
                "/api/product/v1/data-deletions",
                headers={
                    "x-test-user": "user-l",
                    "Idempotency-Key": "custom-agents-delete-unavailable",
                },
                json={"scope": ["agents"], "confirmation": "DELETE CUSTOM AGENTS"},
            )
            assert unavailable_agent_deletion.status_code == 503
            store._owner_data_deleter = SimpleNamespace(
                delete_scheduled_task=lambda **_kwargs: None
            )
            assert (
                client.post(
                    "/api/product/v1/data-deletions",
                    headers={
                        "x-test-user": "user-e",
                        "Idempotency-Key": "scheduled-tasks-delete",
                    },
                    json={
                        "scope": ["scheduled_tasks"],
                        "confirmation": "DELETE PREFERENCES",
                    },
                ).status_code
                == 422
            )
            assert (
                client.post(
                    "/api/product/v1/data-deletions",
                    headers={
                        "x-test-user": "user-m",
                        "Idempotency-Key": "custom-agents-delete-wrong-confirmation",
                    },
                    json={"scope": ["agents"], "confirmation": "DELETE PREFERENCES"},
                ).status_code
                == 422
            )
            assert (
                client.post(
                    "/api/product/v1/data-deletions",
                    headers={
                        "x-test-user": "user-d",
                        "Idempotency-Key": "projects-delete",
                    },
                    json={"scope": ["projects"], "confirmation": "DELETE PREFERENCES"},
                ).status_code
                == 422
            )
            assert (
                client.post(
                    "/api/product/v1/data-exports",
                    headers={"x-test-user": "user-a"},
                    json={"scope": ["preferences"]},
                ).status_code
                == 422
            )

            cancelled = client.post(
                f"/api/product/v1/data-jobs/{job['job_id']}/cancel",
                headers={"x-test-user": "user-a", "x-request-id": "cancel-123"},
            )
            assert cancelled.status_code == 200
            assert cancelled.json()["job"]["status"] == "cancelled"

            deletion = client.post(
                "/api/product/v1/data-deletions",
                headers={
                    "x-test-user": "user-a",
                    "Idempotency-Key": "preferences-delete-api-1",
                },
                json={"scope": ["preferences"], "confirmation": "DELETE PREFERENCES"},
            )
            assert deletion.status_code == 202
            missing_confirmation = client.post(
                "/api/product/v1/data-deletions",
                headers={
                    "x-test-user": "user-a",
                    "Idempotency-Key": "preferences-delete-api-2",
                },
                json={"scope": ["preferences"], "confirmation": "yes"},
            )
            assert missing_confirmation.status_code == 422

            listed = client.get("/api/product/v1/data-jobs", headers={"x-test-user": "user-a"})
            assert listed.status_code == 200
            assert listed.json()["has_more"] is False
            assert {item["job_id"] for item in listed.json()["jobs"]} == {
                job["job_id"],
                deletion.json()["job"]["job_id"],
            }
            deletion_id = deletion.json()["job"]["job_id"]
            assert (
                client.post(
                    f"/api/product/v1/data-jobs/{deletion_id}/cancel",
                    headers={"x-test-user": "user-a"},
                ).status_code
                == 200
            )
            for index in range(8):
                rate_limited_candidate = client.post(
                    "/api/product/v1/data-exports",
                    headers={
                        "x-test-user": "user-a",
                        "Idempotency-Key": f"hourly-api-{index}",
                    },
                    json={"scope": ["preferences"]},
                )
                assert rate_limited_candidate.status_code == 202
                candidate_id = rate_limited_candidate.json()["job"]["job_id"]
                assert (
                    client.post(
                        f"/api/product/v1/data-jobs/{candidate_id}/cancel",
                        headers={"x-test-user": "user-a"},
                    ).status_code
                    == 200
                )
            rate_limited = client.post(
                "/api/product/v1/data-exports",
                headers={
                    "x-test-user": "user-a",
                    "Idempotency-Key": "hourly-api-over-limit",
                },
                json={"scope": ["preferences"]},
            )
            assert rate_limited.status_code == 429
            assert int(rate_limited.headers["retry-after"]) > 0
    finally:
        asyncio.run(store.stop())
        asyncio.run(engine.dispose())


def test_data_job_list_hides_scopes_after_route_permission_revocation() -> None:
    class PagedStore:
        async def list_data_jobs(self, owner_user_id: str, *, limit: int, offset: int):
            assert owner_user_id == "user-a"
            assert limit == 51 and offset == 0
            return [
                {"job_id": "preferences-job", "kind": "export", "scope": ["preferences"]},
                {"job_id": "threads-job", "kind": "export", "scope": ["threads"]},
            ]

    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(app.state, EXTENSION_PRINCIPAL_RESOLVER_KEY, _resolve_test_principal)
    app.include_router(build_router({"data_jobs": {"enabled": True}}, PagedStore()))

    response = TestClient(app).get(
        "/api/product/v1/data-jobs",
        headers={"x-test-user": "user-a", "x-test-permissions": "preferences:read"},
    )

    assert response.status_code == 200
    assert [job["job_id"] for job in response.json()["jobs"]] == ["preferences-job"]


def test_data_job_list_fails_closed_when_scope_provider_is_unavailable() -> None:
    app = FastAPI()

    async def unavailable(_request, **_kwargs):
        raise ExtensionDataScopeError(503, "IAM data-scope authorization is unavailable")

    setattr(app.state, EXTENSION_DATA_SCOPE_CHECKER_KEY, unavailable)
    setattr(app.state, EXTENSION_PRINCIPAL_RESOLVER_KEY, _resolve_test_principal)

    class PagedStore:
        async def list_data_jobs(self, _owner_user_id: str, *, limit: int, offset: int):
            return [{"job_id": "preferences-job", "kind": "export", "scope": ["preferences"]}]

    app.include_router(build_router({"data_jobs": {"enabled": True}}, PagedStore()))
    response = TestClient(app).get(
        "/api/product/v1/data-jobs",
        headers={"x-test-user": "user-a", "x-test-permissions": "preferences:read"},
    )

    assert response.status_code == 503


def test_completed_export_download_is_owner_checked_and_contains_only_preferences(tmp_path) -> None:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'flowdesk-download-api.sqlite'}",
        poolclass=NullPool,
    )
    store = ProductSettingsStore()
    data_directory = tmp_path / "gateway-data"
    app = FastAPI()
    _install_test_scope_checker(app)

    def resolve_test_principal(request):
        return _resolve_test_principal(request)

    setattr(app.state, EXTENSION_PRINCIPAL_RESOLVER_KEY, resolve_test_principal)
    app.include_router(build_router({"data_jobs": {"enabled": True}}, store))

    async def scenario() -> None:
        await store.start(
            ExtensionRuntimeDeps(
                session_factory=async_sessionmaker(engine),
                product_data_directory=data_directory,
                owner_data_authorizer=_AllowOwnerDataAuthorizer(),
            )
        )
        await store.put_for_user("user-a", "workspace.layout", {"density": "compact"})
        await store.put_for_user("user-b", "workspace.layout", {"density": "private"})
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            created = await client.post(
                "/api/product/v1/data-exports",
                headers={
                    "x-test-user": "user-a",
                    "Idempotency-Key": "download-export-1",
                },
                json={"scope": ["preferences"]},
            )
            assert created.status_code == 202
            job_id = created.json()["job"]["job_id"]
            async with asyncio.timeout(4):
                while True:
                    current = await store.get_data_job("user-a", job_id)
                    assert current is not None
                    if current["status"] in {"completed", "failed", "partial"}:
                        break
                    await asyncio.sleep(0.02)
            assert current["status"] == "completed"

            owner_download = await client.get(
                f"/api/product/v1/data-jobs/{job_id}/artifact",
                headers={"x-test-user": "user-a", "x-request-id": "download-request-1"},
            )
            assert owner_download.status_code == 200
            assert owner_download.headers["content-type"].startswith("application/json")
            assert owner_download.headers["content-disposition"].endswith(
                f'"flow-desk-preferences-{job_id}.json"'
            )
            assert b"compact" in owner_download.content
            assert b"private" not in owner_download.content
            revoked_download = await client.get(
                f"/api/product/v1/data-jobs/{job_id}/artifact",
                headers={"x-test-user": "user-a", "x-test-permissions": ""},
            )
            assert revoked_download.status_code == 403
            download_event = next(
                event
                for event in await store.list_audit_events(limit=20, offset=0)
                if event["action"] == "data.export.download_requested"
                and event["resource_id"] == job_id
            )
            assert download_event["actor_user_id"] == "user-a"
            assert download_event["resource_id"] == job_id
            assert download_event["outcome"] == "success"
            assert download_event["request_id"] == "download-request-1"
            assert (
                await client.get(
                    f"/api/product/v1/data-jobs/{job_id}/artifact",
                    headers={"x-test-user": "user-b"},
                )
            ).status_code == 404
            download_events = [
                event
                for event in await store.list_audit_events(limit=20, offset=0)
                if event["action"] == "data.export.download_requested"
            ]
            assert [event["actor_user_id"] for event in download_events] == ["user-a"]
        await store.stop()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(store.stop())
        asyncio.run(engine.dispose())
