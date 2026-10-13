"""Public Gateway account-management API and account-deactivation invariants."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

_TEST_SECRET = "test-secret-key-admin-users-minimum-32-characters"


@pytest.fixture
def client(tmp_path):
    from app.gateway import deps
    from app.gateway.app import create_app
    from app.gateway.auth.config import AuthConfig, set_auth_config
    from deerflow.persistence.engine import close_engine, init_engine

    set_auth_config(AuthConfig(jwt_secret=_TEST_SECRET))
    asyncio.run(
        init_engine(
            "sqlite",
            url=f"sqlite+aiosqlite:///{tmp_path / 'admin-users.db'}",
            sqlite_dir=str(tmp_path),
        )
    )
    deps._cached_local_provider = None
    deps._cached_repo = None
    test_client = TestClient(create_app())
    try:
        yield test_client
    finally:
        deps._cached_local_provider = None
        deps._cached_repo = None
        asyncio.run(close_engine())


def _initialize_admin(client: TestClient) -> tuple[dict, str]:
    response = client.post(
        "/api/v1/auth/initialize",
        json={"email": "admin@example.com", "password": "Str0ng!Pass99"},
    )
    assert response.status_code == 201
    return response.json(), client.cookies.get("access_token")


def _patch_user_status(client: TestClient, user_id: str, is_active: bool):
    csrf_token = client.cookies.get("csrf_token")
    return client.patch(
        f"/api/v1/auth/admin/users/{user_id}",
        headers={"X-CSRF-Token": csrf_token},
        json={"is_active": is_active},
    )


def test_admin_can_list_users_without_exposing_credentials(client):
    from app.gateway.deps import get_local_provider

    admin, _ = _initialize_admin(client)
    user = asyncio.run(
        get_local_provider().create_user(
            email="person@example.com",
            password="S0mething!Strong123",
        )
    )

    response = client.get("/api/v1/auth/admin/users?limit=1&offset=0")

    assert response.status_code == 200
    page = response.json()
    assert page["total"] == 2
    assert page["limit"] == 1
    assert len(page["users"]) == 1
    assert page["users"][0]["id"] == admin["id"]
    assert page["users"][0]["is_active"] is True
    assert "password_hash" not in page["users"][0]
    assert "token_version" not in page["users"][0]

    second_page = client.get("/api/v1/auth/admin/users?limit=10&offset=1")
    assert second_page.status_code == 200
    assert second_page.json()["users"][0]["id"] == str(user.id)


def test_regular_user_cannot_read_or_change_account_status(client):
    from app.gateway.auth import create_access_token
    from app.gateway.deps import get_local_provider

    _initialize_admin(client)
    user = asyncio.run(
        get_local_provider().create_user(
            email="person@example.com",
            password="S0mething!Strong123",
        )
    )
    client.cookies.set(
        "access_token",
        create_access_token(str(user.id), token_version=user.token_version),
    )

    assert client.get("/api/v1/auth/admin/users").status_code == 403
    assert _patch_user_status(client, str(user.id), False).status_code == 403


def test_deactivation_revokes_sessions_and_reactivation_requires_new_login(client):
    from app.gateway.auth import create_access_token
    from app.gateway.deps import get_local_provider
    from deerflow.runtime import RunManager, RunStatus
    from deerflow.runtime.runs.store.memory import MemoryRunStore

    _admin, admin_token = _initialize_admin(client)
    user = asyncio.run(
        get_local_provider().create_user(
            email="person@example.com",
            password="S0mething!Strong123",
        )
    )

    class ScheduledTaskRepo:
        paused: list[tuple[str, dict]] = []

        async def list_by_user(self, user_id):
            assert user_id == str(user.id)
            return [{"id": "scheduled-1", "status": "enabled"}]

        async def pause_with_queue_cancellation(self, task_id, **kwargs):
            self.paused.append((task_id, kwargs))
            return "paused"

    task_repo = ScheduledTaskRepo()
    client.app.state.scheduled_task_repo = task_repo
    run_manager = RunManager(store=MemoryRunStore())
    active_run = asyncio.run(run_manager.create("disabled-user-thread", user_id=str(user.id)))
    asyncio.run(run_manager.set_status(active_run.run_id, RunStatus.running))
    client.app.state.run_manager = run_manager
    old_token = create_access_token(str(user.id), token_version=user.token_version)

    disabled = _patch_user_status(client, str(user.id), False)
    assert disabled.status_code == 200
    assert disabled.json()["is_active"] is False
    assert disabled.json()["active_runs_stopped"] == 1
    assert disabled.json()["active_runs_stop_failed"] == 0
    assert asyncio.run(run_manager.get(active_run.run_id)).status == RunStatus.interrupted
    assert task_repo.paused[0][0] == "scheduled-1"
    assert task_repo.paused[0][1]["allow_executing"] is True
    assert client.get("/api/v1/auth/admin/users").status_code == 200

    client.cookies.set("access_token", old_token)
    assert client.get("/api/v1/auth/me").status_code == 401
    assert asyncio.run(get_local_provider().authenticate({"email": "person@example.com", "password": "S0mething!Strong123"})) is None

    # Restore the already-issued administrator session, then reactivate the
    # user. The old JWT must stay revoked even after the account is active.
    client.cookies.set("access_token", admin_token)
    assert client.get("/api/v1/auth/me").status_code == 200
    reactivated = _patch_user_status(client, str(user.id), True)
    assert reactivated.status_code == 200

    client.cookies.set("access_token", old_token)
    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.delete("access_token")
    login = client.post(
        "/api/v1/auth/login/local",
        data={"username": "person@example.com", "password": "S0mething!Strong123"},
    )
    assert login.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 200


def test_admin_disable_reports_when_active_run_cancellation_is_uncertain(client):
    from app.gateway.deps import get_local_provider

    _initialize_admin(client)
    user = asyncio.run(
        get_local_provider().create_user(
            email="active-run@example.com",
            password="S0mething!Strong123",
        )
    )

    class UncertainRunManager:
        async def cancel_active_runs_for_user(self, user_id):
            assert user_id == str(user.id)
            return {"run-active": "unknown"}

    client.app.state.run_manager = UncertainRunManager()
    response = _patch_user_status(client, str(user.id), False)

    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert response.json()["active_runs_stopped"] == 0
    assert response.json()["active_runs_stop_failed"] == 1


def test_admin_cannot_deactivate_own_account(client):
    admin, _ = _initialize_admin(client)

    response = _patch_user_status(client, admin["id"], False)

    assert response.status_code == 409
    assert client.get("/api/v1/auth/me").status_code == 200


def test_account_status_change_is_sent_to_registered_product_audit_observer(client):
    from app.gateway.deps import get_local_provider
    from deerflow.extensions.registry import ExtensionRegistry

    _initialize_admin(client)
    user = asyncio.run(
        get_local_provider().create_user(
            email="person@example.com",
            password="S0mething!Strong123",
        )
    )
    observed = []

    class AuditObserver:
        async def on_admin_action(self, event) -> None:
            observed.append(event)

    registry = ExtensionRegistry()
    with registry.attributed_to("flow-desk-product:install"):
        registry.admin_action_observer(AuditObserver())
    client.app.state.extensions = registry.build()

    response = _patch_user_status(client, str(user.id), False)

    assert response.status_code == 200
    assert len(observed) == 1
    event = observed[0]
    assert event.actor_user_id != event.resource_id
    assert event.action == "account.status.disable"
    assert event.resource_type == "account"
    assert event.resource_id == str(user.id)
    assert event.outcome == "success"
    assert event.request_id is not None


def test_admin_can_deactivate_another_admin_while_one_remains(client):
    from app.gateway.deps import get_local_provider

    _initialize_admin(client)
    second_admin = asyncio.run(
        get_local_provider().create_user(
            email="second-admin@example.com",
            password="An0ther!Strong123",
            system_role="admin",
        )
    )

    response = _patch_user_status(client, str(second_admin.id), False)

    assert response.status_code == 200
    assert response.json()["is_active"] is False
    page = client.get("/api/v1/auth/admin/users").json()
    assert page["total"] == 2
    assert sum(user["is_active"] and user["system_role"] == "admin" for user in page["users"]) == 1
