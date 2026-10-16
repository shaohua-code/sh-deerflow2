from __future__ import annotations

import asyncio

from deerflow_extension_api import (
    EXTENSION_DATA_SCOPE_CHECKER_KEY,
    EXTENSION_PRINCIPAL_RESOLVER_KEY,
    AdminActionEvent,
    ExtensionPrincipal,
    ExtensionRuntimeDeps,
    OwnerFileEntry,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from flow_desk_product_extension import install
from flow_desk_product_extension.api import build_router
from flow_desk_product_extension.settings import CachedOwnerFilePage, ProductSettingsStore


async def _allow_test_data_scope(_request, **_kwargs) -> None:
    """Simulate a host with local authorization and no Central IAM provider."""


def _install_test_scope_checker(app: FastAPI) -> None:
    setattr(app.state, EXTENSION_DATA_SCOPE_CHECKER_KEY, _allow_test_data_scope)


def test_bootstrap_returns_only_public_config_and_server_identity() -> None:
    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        lambda _request: ExtensionPrincipal(user_id="user-123", is_admin=True),
    )
    app.include_router(
        build_router(
            {
                "name": "Acme Desk",
                "name_zh": "Acme 工作台",
                "features": {"files": True, "unknown_flag": True},
                "api_key": "must-not-leak",
            }
        )
    )

    response = TestClient(app).get("/api/product/v1/bootstrap")

    assert response.status_code == 200
    assert response.json() == {
        "api_version": 1,
        "product": {
            "name": "Acme Desk",
            "name_zh": "Acme 工作台",
            "features": {
                "overview": True,
                "chats": True,
                "agents": True,
                "scheduled_tasks": True,
                "capabilities": True,
                "files": True,
                "data_privacy": False,
                "administration": False,
            },
        },
        "user": {"id": "user-123", "is_admin": True},
    }


def test_bootstrap_fails_closed_when_identity_is_missing() -> None:
    app = FastAPI()
    _install_test_scope_checker(app)
    app.include_router(build_router({}))

    response = TestClient(app).get("/api/product/v1/bootstrap")

    assert response.status_code == 401


def test_public_brand_returns_only_runtime_names_without_authentication() -> None:
    class BrandStore:
        async def read_product_config(self) -> dict[str, object]:
            return {
                "config": {
                    "name": "Runtime Desk",
                    "name_zh": "运行时工作台",
                    "features": {"administration": True},
                    "private_key": "must-not-leak",
                },
                "version": 4,
            }

    app = FastAPI()
    _install_test_scope_checker(app)
    app.include_router(
        build_router(
            {
                "name": "Deploy Desk",
                "name_zh": "部署工作台",
                "api_key": "must-not-leak",
            },
            BrandStore(),  # type: ignore[arg-type]
        )
    )

    response = TestClient(app).get("/api/product/v1/public-brand")

    assert response.status_code == 200
    assert response.json() == {
        "api_version": 1,
        "product": {"name": "Runtime Desk", "name_zh": "运行时工作台"},
    }


def test_public_brand_falls_back_to_deployment_names_when_settings_are_unavailable() -> None:
    class UnavailableBrandStore:
        async def read_product_config(self) -> dict[str, object]:
            raise RuntimeError("settings unavailable")

    app = FastAPI()
    _install_test_scope_checker(app)
    app.include_router(
        build_router(
            {"name": "Deploy Desk", "name_zh": "部署工作台"},
            UnavailableBrandStore(),  # type: ignore[arg-type]
        )
    )

    response = TestClient(app).get("/api/product/v1/public-brand")

    assert response.status_code == 200
    assert response.json()["product"] == {
        "name": "Deploy Desk",
        "name_zh": "部署工作台",
    }


def test_audit_page_uses_a_sentinel_to_report_exact_page_boundaries() -> None:
    class AuditStore:
        async def list_audit_events(self, limit: int, offset: int) -> list[dict[str, str]]:
            rows = [{"event_id": str(index)} for index in range(3)]
            return rows[offset : offset + limit]

    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        lambda _request: ExtensionPrincipal(user_id="admin-1", is_admin=True),
    )
    app.include_router(build_router({}, AuditStore()))

    with TestClient(app) as client:
        full_page = client.get("/api/product/v1/admin/audit-events?limit=2&offset=0")
        last_page = client.get("/api/product/v1/admin/audit-events?limit=2&offset=2")

    assert full_page.status_code == 200
    assert len(full_page.json()["events"]) == 2
    assert full_page.json()["has_more"] is True
    assert last_page.status_code == 200
    assert len(last_page.json()["events"]) == 1
    assert last_page.json()["has_more"] is False


def test_version_route_exposes_only_non_sensitive_distribution_versions() -> None:
    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        lambda _request: ExtensionPrincipal(user_id="user-123"),
    )
    app.include_router(build_router({"name": "Acme Desk", "api_key": "hidden"}))

    response = TestClient(app).get("/api/product/v1/version")

    assert response.status_code == 200
    assert response.json()["api_version"] == 1
    assert response.json()["product"]["name"] == "Acme Desk"
    assert isinstance(response.json()["product"]["version"], str)
    assert response.json()["engine"]["name"] == "DeerFlow"
    assert isinstance(response.json()["engine"]["version"], str)
    assert "api_key" not in response.json()


def test_file_catalog_route_uses_authenticated_owner_and_returns_metadata_only() -> None:
    class CatalogStore:
        def __init__(self) -> None:
            self.calls = []
            self.invalidations = []

        async def invalidate_owner_file_catalog_entry(self, owner_user_id, file_id):
            self.invalidations.append((owner_user_id, file_id))
            return True

        async def list_owner_files(self, owner_user_id, *, limit, offset, query="", refresh=False):
            self.calls.append((owner_user_id, limit, offset, query, refresh))
            entries = (
                OwnerFileEntry(
                    file_id="thread_upload:thread-1:notes.txt",
                    source="thread_upload",
                    name="notes.txt",
                    size_bytes=12,
                    artifact_url="/api/threads/thread-1/artifacts/user-data/uploads/notes.txt",
                    storage_name="notes.txt",
                    thread_id="thread-1",
                    thread_name="Planning",
                ),
                OwnerFileEntry(
                    file_id="project-document:project-1:doc-1",
                    source="project_document",
                    name="plan.pdf",
                    size_bytes=24,
                    artifact_url="/api/projects/project-1/documents/doc-1/content?download=true",
                    storage_name="must-not-leak/private/path",
                    project_id="project-1",
                    project_name="Planning",
                    document_id="doc-1",
                ),
            )
            return CachedOwnerFilePage(
                files=entries[offset : offset + limit],
                total=len(entries),
                has_more=offset + limit < len(entries),
                next_offset=offset + limit if offset + limit < len(entries) else None,
                truncated=False,
                failed_count=0,
                coverage_notes=("Bounded owner scan.",),
                catalog_updated_at=None,
                catalog_stale=False,
                catalog_refresh_deferred=False,
            )

    settings_store = CatalogStore()
    app = FastAPI()
    _install_test_scope_checker(app)
    app.include_router(build_router({}, settings_store))
    client = TestClient(app)

    assert client.get("/api/product/v1/files").status_code == 401
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        lambda _request: ExtensionPrincipal(
            user_id="owner-1",
            permissions=("threads:read",),
        ),
    )
    denied = client.get("/api/product/v1/files?query=plan")
    assert denied.status_code == 403
    assert settings_store.calls == []

    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        lambda _request: ExtensionPrincipal(
            user_id="owner-1",
            permissions=("threads:read", "projects:read"),
        ),
    )
    response = client.get(
        "/api/product/v1/files?limit=20&offset=0&query=plan&user_id=attacker&refresh=true"
    )

    assert response.status_code == 200
    payload = response.json()
    assert settings_store.calls == [("owner-1", 20, 0, "plan", True)]
    assert payload["total"] == 2
    assert payload["coverage_notes"] == ["Bounded owner scan."]
    assert payload["files"][0]["storage_name"] == "notes.txt"
    assert payload["files"][1]["storage_name"] is None
    assert "must-not-leak" not in response.text
    assert "content" not in payload["files"][0]

    invalidation = client.delete(
        "/api/product/v1/files/catalog-entry?file_id=thread_upload%3Athread-1%3Anotes.txt"
        "&user_id=attacker"
    )
    assert invalidation.status_code == 200
    assert invalidation.json() == {"api_version": 1, "invalidated": True}
    assert settings_store.invalidations == [("owner-1", "thread_upload:thread-1:notes.txt")]

    export_manifest = client.get("/api/product/v1/files?limit=10000&offset=0")
    assert export_manifest.status_code == 200
    assert settings_store.calls[-1] == ("owner-1", 10_000, 0, "", False)
    assert export_manifest.json()["limit"] == 10_000


def test_file_catalog_degrades_when_an_older_host_has_no_reader_capability() -> None:
    engine = create_async_engine("sqlite+aiosqlite://")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    settings_store = ProductSettingsStore()

    async def run() -> None:
        try:
            await settings_store.start(
                ExtensionRuntimeDeps(
                    session_factory=session_factory,
                    owner_data_reader=object(),
                )
            )
            result = await settings_store.list_owner_files(
                "owner-1", limit=50, offset=0, query="plan"
            )
            assert result is None
        finally:
            await settings_store.stop()
            await engine.dispose()

    asyncio.run(run())


def test_data_job_page_reports_whether_more_owner_jobs_exist() -> None:
    class PagedStore:
        def __init__(self) -> None:
            self.calls = []

        async def list_data_job_authorization_keys(self, owner_user_id):
            assert owner_user_id == "owner-1"
            return ["export:preferences"]

        async def list_data_jobs(
            self,
            owner_user_id,
            *,
            limit,
            offset,
            authorization_keys,
        ):
            self.calls.append((owner_user_id, limit, offset, tuple(authorization_keys)))
            rows = [
                {
                    "job_id": f"job-{index}",
                    "kind": "export",
                    "scope": ["preferences"],
                }
                for index in range(3)
            ]
            return rows[offset : offset + limit]

    store = PagedStore()
    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        lambda _request: ExtensionPrincipal(
            user_id="owner-1",
            permissions=("preferences:read",),
        ),
    )
    app.include_router(build_router({"data_jobs": {"enabled": True}}, store))

    client = TestClient(app)
    first = client.get("/api/product/v1/data-jobs?limit=2&offset=0")
    second = client.get("/api/product/v1/data-jobs?limit=2&offset=2")

    assert first.status_code == 200
    assert [job["job_id"] for job in first.json()["jobs"]] == ["job-0", "job-1"]
    assert first.json()["has_more"] is True
    assert second.status_code == 200
    assert [job["job_id"] for job in second.json()["jobs"]] == ["job-2"]
    assert second.json()["has_more"] is False
    assert store.calls == [
        ("owner-1", 3, 0, ("export:preferences",)),
        ("owner-1", 3, 2, ("export:preferences",)),
    ]


def test_product_extension_registers_its_store_for_gateway_admin_audits() -> None:
    from deerflow.extensions.registry import ExtensionRegistry

    # This extension also uses the 0.2.18 background owner-data auth contract;
    # older hosts must fail compatibility checks before the extension loads.
    assert install.__deerflow_api__ == "0.2.18"

    registry = ExtensionRegistry()
    with registry.attributed_to("flow-desk-product:install"):
        install(registry, {})
    extensions = registry.build()

    assert len(extensions.services) == 1
    assert len(extensions.admin_action_observers) == 1
    assert extensions.admin_action_observers[0][1] is extensions.services[0][1]


def test_host_actions_are_persisted_as_metadata_only() -> None:
    from datetime import UTC, datetime

    # 内存 SQLite 验证真实迁移与落库，同时避免 Windows 临时目录权限依赖。
    engine = create_async_engine("sqlite+aiosqlite://")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    settings_store = ProductSettingsStore()
    events = [
        AdminActionEvent(
            actor_user_id="admin-1",
            action="account.status.disable",
            resource_type="account",
            resource_id="user-2",
            outcome="success",
            occurred_at=datetime(2026, 9, 28, tzinfo=UTC),
            request_id="trace-123",
        ),
        AdminActionEvent(
            actor_user_id="owner-1",
            action="upload.delete",
            resource_type="thread_upload",
            resource_id="thread-2",
            outcome="success",
            occurred_at=datetime(2026, 9, 29, tzinfo=UTC),
            request_id="trace-456",
        ),
    ]

    async def persist_and_read() -> list[dict]:
        await settings_store.start(ExtensionRuntimeDeps(session_factory=session_factory))
        for event in events:
            await settings_store.on_admin_action(event)
        return await settings_store.list_audit_events(limit=10, offset=0)

    try:
        audit_events = asyncio.run(persist_and_read())
        assert len(audit_events) == 2
        by_action = {event["action"]: event for event in audit_events}
        assert by_action["account.status.disable"]["actor_user_id"] == "admin-1"
        assert by_action["account.status.disable"]["resource_id"] == "user-2"
        assert by_action["account.status.disable"]["request_id"] == "trace-123"
        assert by_action["upload.delete"]["actor_user_id"] == "owner-1"
        assert by_action["upload.delete"]["resource_type"] == "thread_upload"
        assert by_action["upload.delete"]["resource_id"] == "thread-2"
        assert by_action["upload.delete"]["request_id"] == "trace-456"
        assert "private-name.pdf" not in str(by_action["upload.delete"])
        assert all(event["outcome"] == "success" for event in audit_events)
    finally:
        asyncio.run(settings_store.stop())
        asyncio.run(engine.dispose())


def test_user_settings_are_persisted_and_scoped_to_server_identity(tmp_path) -> None:
    """设置 owner 来自 Gateway principal；请求体不能读写其他用户的数据。"""
    database_path = tmp_path / "flow-desk-settings.sqlite"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path}",
        poolclass=NullPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    settings_store = ProductSettingsStore()
    runtime_deps = ExtensionRuntimeDeps(session_factory=session_factory)
    asyncio.run(settings_store.start(runtime_deps))
    # 启动第二次应读到自有 version table 并保持幂等。
    asyncio.run(settings_store.start(runtime_deps))

    async def read_product_revision() -> str:
        async with engine.connect() as connection:
            result = await connection.exec_driver_sql(
                "SELECT version_num FROM flowdesk_alembic_version"
            )
            return result.scalar_one()

    assert asyncio.run(read_product_revision()) == "fd_0008"

    app = FastAPI()
    _install_test_scope_checker(app)

    def resolve_test_principal(request):
        # 测试用 resolver 模拟 Gateway 已验证的登录态，不是产品 API 的身份来源。
        user_id = request.headers.get("x-test-user")
        if user_id is None:
            return None
        permissions = {
            "admin": ("preferences:read", "preferences:write"),
            "user-a": ("preferences:read", "preferences:write"),
            "user-b": ("preferences:read",),
        }.get(user_id, ())
        return ExtensionPrincipal(
            user_id=user_id,
            is_admin=user_id == "admin",
            permissions=permissions,
        )

    setattr(app.state, EXTENSION_PRINCIPAL_RESOLVER_KEY, resolve_test_principal)
    app.include_router(build_router({}, settings_store))

    try:
        with TestClient(app) as client:
            assert client.get("/api/product/v1/settings").status_code == 401

            user_a = client.get(
                "/api/product/v1/settings",
                headers={"x-test-user": "user-a"},
            )
            assert user_a.status_code == 200
            assert user_a.json() == {"api_version": 1, "settings": []}

            saved = client.put(
                "/api/product/v1/settings/workspace.layout",
                headers={"x-test-user": "user-a", "x-request-id": "trace-123"},
                json={"value": {"density": "comfortable", "sidebar": True}},
            )
            assert saved.status_code == 200
            assert saved.json() == {
                "api_version": 1,
                "key": "workspace.layout",
                "value": {"density": "comfortable", "sidebar": True},
            }

            user_b = client.get(
                "/api/product/v1/settings",
                headers={"x-test-user": "user-b"},
            )
            assert user_b.json() == {"api_version": 1, "settings": []}

            # 偏好只读角色可查询，但不得通过 PUT 或 DELETE 绕过 write grant。
            denied_write = client.put(
                "/api/product/v1/settings/should.not.write",
                headers={"x-test-user": "user-b"},
                json={"value": "blocked"},
            )
            denied_delete = client.delete(
                "/api/product/v1/settings/workspace.layout",
                headers={"x-test-user": "user-b"},
            )
            assert denied_write.status_code == 403
            assert denied_delete.status_code == 403
            assert asyncio.run(settings_store.list_for_user("user-b")) == []

            # body 不允许自报 user_id，owner 始终由 Gateway principal 决定。
            forged_owner = client.put(
                "/api/product/v1/settings/forged.owner",
                headers={"x-test-user": "user-a"},
                json={"value": "ignored", "user_id": "user-b"},
            )
            assert forged_owner.status_code == 422

            # 相同 owner/key 是幂等覆盖，不会累积重复记录。
            client.put(
                "/api/product/v1/settings/workspace.layout",
                headers={"x-test-user": "user-a"},
                json={"value": {"density": "compact"}},
            )
            asyncio.run(settings_store.stop())
            asyncio.run(settings_store.start(runtime_deps))
            assert client.get(
                "/api/product/v1/settings",
                headers={"x-test-user": "user-a"},
            ).json()["settings"] == [{"key": "workspace.layout", "value": {"density": "compact"}}]

            assert (
                client.delete(
                    "/api/product/v1/settings/workspace.layout",
                    headers={"x-test-user": "user-a"},
                ).status_code
                == 204
            )
            assert (
                client.get(
                    "/api/product/v1/settings",
                    headers={"x-test-user": "user-a"},
                ).json()["settings"]
                == []
            )

            denied_audit = client.get(
                "/api/product/v1/admin/audit-events",
                headers={"x-test-user": "user-a"},
            )
            assert denied_audit.status_code == 403

            audit = client.get(
                "/api/product/v1/admin/audit-events?limit=10",
                headers={"x-test-user": "admin"},
            )
            assert audit.status_code == 200
            events = audit.json()["events"]
            assert [event["action"] for event in events].count("settings.write") == 2
            assert [event["action"] for event in events].count("settings.delete") == 1
            assert all(event["actor_user_id"] == "user-a" for event in events)
            assert all("value" not in event and "api_key" not in event for event in events)
            assert any(event["request_id"] == "trace-123" for event in events)
            assert audit.json()["has_more"] is False

            # 哨兵查询能分辨“本页刚好满”与“后面还有记录”，避免空白的最后一页。
            full_page = client.get(
                "/api/product/v1/admin/audit-events?limit=2&offset=0",
                headers={"x-test-user": "admin"},
            )
            assert full_page.status_code == 200
            assert len(full_page.json()["events"]) == 2
            assert full_page.json()["has_more"] is True
            last_page = client.get(
                "/api/product/v1/admin/audit-events?limit=2&offset=2",
                headers={"x-test-user": "admin"},
            )
            assert len(last_page.json()["events"]) == 1
            assert last_page.json()["has_more"] is False

            # 非管理员 principal 不能借管理路由读取跨用户审计。
            non_admin = client.get(
                "/api/product/v1/admin/audit-events",
                headers={"x-test-user": "user-b"},
            )
            assert non_admin.status_code == 403

            invalid_page = client.get(
                "/api/product/v1/admin/audit-events?limit=101",
                headers={"x-test-user": "admin"},
            )
            assert invalid_page.status_code == 422

            admin_headers = {"x-test-user": "admin"}
            current_config = client.get(
                "/api/product/v1/admin/settings",
                headers=admin_headers,
            )
            assert current_config.status_code == 200
            assert current_config.json()["version"] == 0
            assert current_config.json()["product"]["name"] == "Flow Desk"

            missing_row_conflict = client.patch(
                "/api/product/v1/admin/settings",
                headers=admin_headers,
                json={"expected_version": 1, "name": "Must not jump versions"},
            )
            assert missing_row_conflict.status_code == 409
            assert missing_row_conflict.json()["detail"]["version"] == 0

            forbidden_config = client.get(
                "/api/product/v1/admin/settings",
                headers={"x-test-user": "user-a"},
            )
            assert forbidden_config.status_code == 403

            updated_config = client.patch(
                "/api/product/v1/admin/settings",
                headers={**admin_headers, "x-request-id": "config-update-1"},
                json={
                    "expected_version": 0,
                    "name": "Acme Desk",
                    "features": {"administration": True, "files": True},
                },
            )
            assert updated_config.status_code == 200
            assert updated_config.json()["version"] == 1
            assert updated_config.json()["product"]["name"] == "Acme Desk"
            assert updated_config.json()["product"]["features"]["files"] is True

            stale_config = client.patch(
                "/api/product/v1/admin/settings",
                headers=admin_headers,
                json={"expected_version": 0, "name": "Stale name"},
            )
            assert stale_config.status_code == 409
            assert stale_config.json()["detail"]["version"] == 1

            unknown_feature = client.patch(
                "/api/product/v1/admin/settings",
                headers=admin_headers,
                json={"expected_version": 1, "features": {"arbitrary": True}},
            )
            assert unknown_feature.status_code == 422
            unavailable_feature = client.patch(
                "/api/product/v1/admin/settings",
                headers=admin_headers,
                json={"expected_version": 1, "features": {"data_privacy": True}},
            )
            assert unavailable_feature.status_code == 422
            secret_injection = client.patch(
                "/api/product/v1/admin/settings",
                headers=admin_headers,
                json={"expected_version": 1, "api_key": "must-not-store"},
            )
            assert secret_injection.status_code == 422

            effective_bootstrap = client.get(
                "/api/product/v1/bootstrap",
                headers={"x-test-user": "user-a"},
            )
            assert effective_bootstrap.json()["product"]["name"] == "Acme Desk"
            assert effective_bootstrap.json()["product"]["features"]["files"] is True

            config_audit = client.get(
                "/api/product/v1/admin/audit-events?limit=10",
                headers=admin_headers,
            ).json()["events"]
            assert any(
                event["action"] == "product.settings.patch"
                and event["actor_user_id"] == "admin"
                and event["request_id"] == "config-update-1"
                for event in config_audit
            )
            assert (
                client.get(
                    "/api/product/v1/settings",
                    headers={"x-test-user": "user-b"},
                ).json()["settings"]
                == []
            )

            invalid_key = client.put(
                "/api/product/v1/settings/Bad%20Key",
                headers={"x-test-user": "user-a"},
                json={"value": "ignored"},
            )
            assert invalid_key.status_code == 422

            oversized = client.put(
                "/api/product/v1/settings/too.large",
                headers={"x-test-user": "user-a"},
                json={"value": "x" * (64 * 1024)},
            )
            assert oversized.status_code == 422
    finally:
        asyncio.run(settings_store.stop())
        asyncio.run(engine.dispose())


def test_settings_routes_fail_closed_when_extension_storage_is_not_ready() -> None:
    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        lambda _request: ExtensionPrincipal(
            user_id="user-123",
            is_admin=False,
            permissions=("preferences:read",),
        ),
    )
    app.include_router(build_router({}))

    response = TestClient(app).get("/api/product/v1/settings")

    assert response.status_code == 503


def test_user_settings_routes_require_permissions_before_storage_access() -> None:
    app = FastAPI()
    _install_test_scope_checker(app)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        lambda _request: ExtensionPrincipal(user_id="user-123"),
    )
    app.include_router(build_router({}, settings_store=None))

    with TestClient(app) as client:
        assert client.get("/api/product/v1/settings").status_code == 403
        assert (
            client.put(
                "/api/product/v1/settings/workspace.display",
                json={"value": "compact"},
            ).status_code
            == 403
        )
        assert client.delete("/api/product/v1/settings/workspace.display").status_code == 403


def test_product_migrations_upgrade_existing_fd_0001_settings_without_data_loss(tmp_path) -> None:
    """旧用户设置库升级到当前 product revision 时必须保留原行与产品表。"""
    database_path = tmp_path / "flow-desk-upgrade.sqlite"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path}",
        poolclass=NullPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def seed_fd_0001() -> None:
        async with engine.begin() as connection:
            await connection.exec_driver_sql(
                "CREATE TABLE flowdesk_alembic_version "
                "(version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
            )
            await connection.exec_driver_sql(
                "INSERT INTO flowdesk_alembic_version (version_num) VALUES ('fd_0001')"
            )
            await connection.exec_driver_sql(
                "CREATE TABLE flowdesk_user_settings "
                "(user_id VARCHAR(255) NOT NULL, setting_key VARCHAR(64) NOT NULL, "
                "value JSON NOT NULL, updated_at DATETIME NOT NULL, "
                "PRIMARY KEY (user_id, setting_key))"
            )
            await connection.exec_driver_sql(
                "INSERT INTO flowdesk_user_settings "
                "(user_id, setting_key, value, updated_at) "
                "VALUES ('user-1', 'workspace.display', '\"compact\"', CURRENT_TIMESTAMP)"
            )

    store = ProductSettingsStore()
    try:
        asyncio.run(seed_fd_0001())
        asyncio.run(store.start(ExtensionRuntimeDeps(session_factory=session_factory)))
        assert asyncio.run(store.list_for_user("user-1")) == [
            {"key": "workspace.display", "value": "compact"}
        ]
        assert asyncio.run(store.list_audit_events(limit=10, offset=0)) == []

        async def read_revision() -> str:
            async with engine.connect() as connection:
                result = await connection.exec_driver_sql(
                    "SELECT version_num FROM flowdesk_alembic_version"
                )
                return result.scalar_one()

        assert asyncio.run(read_revision()) == "fd_0008"

        async def read_job_table() -> bool:
            async with engine.connect() as connection:
                result = await connection.exec_driver_sql(
                    "SELECT name FROM sqlite_master WHERE type = 'table' "
                    "AND name = 'flowdesk_data_jobs'"
                )
                return result.scalar_one_or_none() == "flowdesk_data_jobs"

        assert asyncio.run(read_job_table())

        async def read_file_catalog_tables() -> bool:
            async with engine.connect() as connection:
                result = await connection.exec_driver_sql(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN "
                    "('flowdesk_file_catalog_state', 'flowdesk_file_catalog_entries')"
                )
                return {row["name"] for row in result.mappings()} == {
                    "flowdesk_file_catalog_state",
                    "flowdesk_file_catalog_entries",
                }

        assert asyncio.run(read_file_catalog_tables())

        async def read_active_job_index() -> bool:
            async with engine.connect() as connection:
                result = await connection.exec_driver_sql("PRAGMA index_list('flowdesk_data_jobs')")
                return any(
                    row["name"] == "uq_flowdesk_data_jobs_active_owner" and row["unique"]
                    for row in result.mappings()
                )

        assert asyncio.run(read_active_job_index())

        async def read_rate_limit_table() -> bool:
            async with engine.connect() as connection:
                result = await connection.exec_driver_sql(
                    "SELECT name FROM sqlite_master WHERE type = 'table' "
                    "AND name = 'flowdesk_data_job_rate_limits'"
                )
                return result.scalar_one_or_none() == "flowdesk_data_job_rate_limits"

        assert asyncio.run(read_rate_limit_table())
    finally:
        asyncio.run(store.stop())
        asyncio.run(engine.dispose())


def test_fd_0008_backfills_data_job_authorization_keys(tmp_path) -> None:
    database_path = tmp_path / "flow-desk-data-job-authorization-backfill.sqlite"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path}",
        poolclass=NullPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    store = ProductSettingsStore()

    async def seed_fd_0007() -> None:
        async with engine.begin() as connection:
            await connection.exec_driver_sql(
                "CREATE TABLE flowdesk_alembic_version "
                "(version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
            )
            await connection.exec_driver_sql(
                "INSERT INTO flowdesk_alembic_version (version_num) VALUES ('fd_0007')"
            )
            await connection.exec_driver_sql(
                "CREATE TABLE flowdesk_data_jobs ("
                "job_id VARCHAR(36) NOT NULL PRIMARY KEY, "
                "owner_user_id VARCHAR(255) NOT NULL, kind VARCHAR(24) NOT NULL, "
                "scope JSON NOT NULL, created_at DATETIME NOT NULL)"
            )
            await connection.exec_driver_sql(
                "INSERT INTO flowdesk_data_jobs "
                "(job_id, owner_user_id, kind, scope, created_at) "
                "VALUES ('old-job', 'user-a', 'export', '[\"preferences\"]', CURRENT_TIMESTAMP)"
            )

    async def read_revision_and_backfill() -> tuple[str, str]:
        async with engine.connect() as connection:
            revision = await connection.exec_driver_sql(
                "SELECT version_num FROM flowdesk_alembic_version"
            )
            authorization_key = await connection.exec_driver_sql(
                "SELECT authorization_key FROM flowdesk_data_jobs WHERE job_id = 'old-job'"
            )
            return revision.scalar_one(), authorization_key.scalar_one()

    try:
        asyncio.run(seed_fd_0007())
        asyncio.run(store.start(ExtensionRuntimeDeps(session_factory=session_factory)))
        assert asyncio.run(read_revision_and_backfill()) == ("fd_0008", "export:preferences")
    finally:
        asyncio.run(store.stop())
        asyncio.run(engine.dispose())
