"""删除能力发现只投影同步布尔标记，不执行宿主读取或删除。"""

from __future__ import annotations

from types import SimpleNamespace

from deerflow_extension_api import (
    EXTENSION_DATA_SCOPE_CHECKER_KEY,
    EXTENSION_PRINCIPAL_RESOLVER_KEY,
    ExtensionPrincipal,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient

from flow_desk_product_extension.api import build_router
from flow_desk_product_extension.settings import ProductSettingsStore


async def _allow_test_data_scope(_request, **_kwargs) -> None:
    """Simulate Gateway's local-RBAC pass-through for these API tests."""


def _client(
    store: ProductSettingsStore | None,
    *,
    authenticated: bool = True,
    enabled: bool = True,
) -> TestClient:
    app = FastAPI()
    setattr(app.state, EXTENSION_DATA_SCOPE_CHECKER_KEY, _allow_test_data_scope)
    setattr(
        app.state,
        EXTENSION_PRINCIPAL_RESOLVER_KEY,
        lambda _request: (
            ExtensionPrincipal(
                user_id="user-a",
                permissions=("memory:delete",),
            )
            if authenticated
            else None
        ),
    )
    app.include_router(build_router({"data_jobs": {"enabled": enabled}}, store))
    return TestClient(app)


def test_data_capabilities_require_authentication_and_operator_opt_in() -> None:
    store = ProductSettingsStore()

    assert (
        _client(store, authenticated=False).get("/api/product/v1/data-capabilities").status_code
        == 401
    )
    assert _client(store, enabled=False).get("/api/product/v1/data-capabilities").status_code == 404
    assert _client(None).get("/api/product/v1/data-capabilities").status_code == 503


def test_data_capabilities_keep_a_closed_boolean_whitelist_on_an_older_gateway() -> None:
    # 旧宿主没有可选 owner capability 时，也不应把不可用操作展示成可提交。
    response = _client(ProductSettingsStore()).get("/api/product/v1/data-capabilities")

    assert response.status_code == 200
    assert response.json() == {
        "api_version": 1,
        "deletion_scopes": {
            "preferences": True,
            "memory": False,
            "files": False,
            "threads": False,
            "projects": False,
            "agents": False,
            "scheduled_tasks": False,
        },
    }


def test_data_capabilities_read_current_host_flags_without_invoking_host_methods() -> None:
    def unexpected_host_call(**_kwargs):
        raise AssertionError("Capability discovery must not call host operations")

    store = ProductSettingsStore()
    store._owner_data_reader = SimpleNamespace(
        list_threads=unexpected_host_call,
        list_projects=unexpected_host_call,
        list_agents=unexpected_host_call,
        list_scheduled_tasks=unexpected_host_call,
        list_files=unexpected_host_call,
    )
    store._owner_data_deleter = SimpleNamespace(
        supports_project_delete=True,
        supports_memory_clear=True,
        supports_file_delete=True,
        delete_thread=unexpected_host_call,
        delete_project=unexpected_host_call,
        delete_agent=unexpected_host_call,
        delete_scheduled_task=unexpected_host_call,
        delete_memory=unexpected_host_call,
        delete_file=unexpected_host_call,
    )
    client = _client(store)

    supported = client.get("/api/product/v1/data-capabilities")
    assert supported.status_code == 200
    assert supported.json()["deletion_scopes"] == {
        "preferences": True,
        "memory": True,
        "files": True,
        "threads": True,
        "projects": True,
        "agents": True,
        "scheduled_tasks": True,
    }

    # 后端配置可以变化；上一轮发现不能代替创建任务时的最终校验。
    store._owner_data_deleter.supports_memory_clear = False
    store._owner_data_deleter.supports_file_delete = False
    changed = client.get("/api/product/v1/data-capabilities").json()["deletion_scopes"]
    assert changed["memory"] is False
    assert changed["files"] is False
    assert changed["threads"] is True
    blocked = client.post(
        "/api/product/v1/data-deletions",
        headers={"Idempotency-Key": "capability-changed-before-submission"},
        json={"scope": ["memory"], "confirmation": "DELETE MY MEMORY"},
    )
    assert blocked.status_code == 503


def test_data_capability_projection_failure_is_closed_and_does_not_disclose_details(caplog) -> None:
    class UnavailableStore(ProductSettingsStore):
        @property
        def can_delete_memory(self) -> bool:
            raise RuntimeError("private-host-path-and-credentials")

    response = _client(UnavailableStore()).get("/api/product/v1/data-capabilities")

    assert response.status_code == 200
    assert response.json()["deletion_scopes"]["memory"] is False
    assert "private-host-path-and-credentials" not in response.text
    assert "private-host-path-and-credentials" not in caplog.text
    assert "can_delete_memory" in caplog.text
    assert "RuntimeError" in caplog.text


def test_non_boolean_capability_projections_are_never_treated_as_enabled(caplog) -> None:
    # 错误的方法对象、数值和字符串都不能通过 Python truthiness 放开删除入口。
    store = SimpleNamespace(
        can_delete_memory=1,
        can_delete_files="true",
        can_delete_thread_history=lambda: True,
        can_delete_projects=None,
        can_delete_custom_agents=[],
        can_delete_scheduled_task_definitions=False,
        private_token="never-return-this",
    )
    response = _client(store).get("/api/product/v1/data-capabilities")

    assert response.status_code == 200
    scopes = response.json()["deletion_scopes"]
    assert scopes["preferences"] is True
    assert all(value is False for key, value in scopes.items() if key != "preferences")
    assert "never-return-this" not in response.text
    assert "never-return-this" not in caplog.text


def test_async_capability_property_is_rejected_without_constructing_a_coroutine(caplog) -> None:
    class AsyncStore(ProductSettingsStore):
        @property
        async def can_delete_memory(self) -> bool:
            raise AssertionError("Capability discovery must not await host operations")

    response = _client(AsyncStore()).get("/api/product/v1/data-capabilities")

    assert response.status_code == 200
    assert response.json()["deletion_scopes"]["memory"] is False
    assert "can_delete_memory" in caplog.text
