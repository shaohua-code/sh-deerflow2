"""Route-level authorization tests for the Gateway permission decorators."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from app.gateway.auth.models import User
from app.gateway.auth_middleware import AuthMiddleware
from app.gateway.authz import (
    AuthContext,
    Permissions,
    _authenticate,
    _get_cached_route_provider,
    require_permission,
    resolve_route_permissions,
    resolve_route_permissions_for_request,
    resolve_scheduled_task_authorization,
)
from app.gateway.routers import runs, scheduled_tasks
from deerflow.authz.provider import AuthzDecision, AuthzReason
from deerflow.authz.rbac import RbacAuthorizationProvider
from deerflow.config.authorization_config import AuthorizationConfig, AuthorizationProviderConfig

_EXPECTED_ROUTE_PERMISSIONS = [
    Permissions.THREADS_READ,
    Permissions.THREADS_WRITE,
    Permissions.THREADS_DELETE,
    Permissions.RUNS_CREATE,
    Permissions.RUNS_READ,
    Permissions.RUNS_CANCEL,
    Permissions.PROJECTS_READ,
    Permissions.PROJECTS_WRITE,
    Permissions.PROJECTS_DELETE,
    Permissions.MEMORY_READ,
    Permissions.MEMORY_WRITE,
    Permissions.MEMORY_DELETE,
    Permissions.MEMORY_ADMIN,
    Permissions.PREFERENCES_READ,
    Permissions.PREFERENCES_WRITE,
    Permissions.AGENTS_READ,
    Permissions.AGENTS_WRITE,
    Permissions.AGENTS_DELETE,
    Permissions.AGENTS_ADMIN,
    Permissions.CHANNELS_READ,
    Permissions.CHANNELS_WRITE,
    Permissions.CHANNELS_ADMIN,
    Permissions.INTEGRATIONS_READ,
    Permissions.INTEGRATIONS_WRITE,
    Permissions.INTEGRATIONS_ADMIN,
    Permissions.SKILLS_READ,
    Permissions.SKILLS_WRITE,
    Permissions.SKILLS_DELETE,
    Permissions.SKILLS_ADMIN,
    Permissions.SUBAGENTS_READ,
    Permissions.SUBAGENTS_ADMIN,
    Permissions.MCP_ADMIN,
]


class _RecordingProvider:
    name = "recording"

    def __init__(
        self,
        *,
        denied: set[str] | None = None,
        errors: set[str] | None = None,
    ) -> None:
        self.denied = denied or set()
        self.errors = errors or set()
        self.requests = []

    def authorize(self, request):
        raise AssertionError("route authorization must use the async provider API")

    async def aauthorize(self, request):
        self.requests.append(request)
        if request.target in self.errors:
            raise RuntimeError(f"provider failed for {request.target}")
        allowed = request.target not in self.denied
        return AuthzDecision(
            allow=allowed,
            reasons=[AuthzReason(code="authz.allowed" if allowed else "authz.denied")],
        )

    def filter_resources(self, principal, resource_type, candidates):
        raise AssertionError("route authorization must preserve per-action requests")


def _user(**overrides):
    values = {
        "id": "user-123",
        "system_role": "user",
        "oauth_provider": "github",
        "oauth_id": "oauth-456",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _enable_authorization(monkeypatch, provider, *, fail_closed: bool = True) -> None:
    config = AuthorizationConfig(
        enabled=True,
        fail_closed=fail_closed,
        default_role="user",
    )
    monkeypatch.setattr("app.gateway.authz._get_route_authorization_config", lambda: config)
    # Bypass the provider cache so each test gets its own provider instance.
    monkeypatch.setattr("app.gateway.authz._get_cached_route_provider", lambda c: provider)


@pytest.mark.asyncio
async def test_route_permissions_disabled_preserves_all_permissions(monkeypatch):
    config = AuthorizationConfig(enabled=False)
    monkeypatch.setattr("app.gateway.authz._get_route_authorization_config", lambda: config)
    # Bypass cache + ensure provider is never resolved when disabled.
    cached = AsyncMock(side_effect=AssertionError("disabled authorization must not resolve a provider"))
    monkeypatch.setattr("app.gateway.authz._get_cached_route_provider", cached)

    permissions = await resolve_route_permissions(_user(), is_internal=False)

    assert permissions == _EXPECTED_ROUTE_PERMISSIONS
    cached.assert_not_called()


@pytest.mark.asyncio
async def test_scheduled_task_authorization_rechecks_iam_and_reused_thread_scope(monkeypatch):
    user = _user(is_active=True)
    central_provider = SimpleNamespace(name="central-iam", requires_iam_identity=True)
    authorization_config = AuthorizationConfig(enabled=True, fail_closed=True, default_role="user")
    credential = object()
    authz_attributes = {"iam_credentials": credential}
    oidc_service = object()
    provider_configs = {"github": object()}
    local_provider = SimpleNamespace(get_user=AsyncMock(return_value=user))
    app_config = SimpleNamespace(auth=SimpleNamespace(oidc=SimpleNamespace(providers=provider_configs)))
    scope_check = AsyncMock()
    thread_store = SimpleNamespace(check_access=AsyncMock(return_value=True))

    monkeypatch.setattr("app.gateway.authz._get_route_authorization_config", lambda: authorization_config)
    monkeypatch.setattr("app.gateway.authz._get_cached_route_provider", lambda _config: central_provider)
    monkeypatch.setattr("app.gateway.deps.get_local_provider", lambda: local_provider)
    monkeypatch.setattr("app.gateway.authz.require_iam_data_scope_for_request", scope_check)
    monkeypatch.setattr(
        "app.gateway.authz.resolve_route_permissions",
        AsyncMock(return_value=[Permissions.THREADS_READ, Permissions.THREADS_WRITE, Permissions.RUNS_CREATE]),
    )
    load_active_credentials = AsyncMock(return_value=authz_attributes)
    monkeypatch.setattr(
        "app.gateway.auth.iam_token_vault.load_active_iam_authorization_attributes",
        load_active_credentials,
        raising=False,
    )
    monkeypatch.setattr("deerflow.config.app_config.get_app_config", lambda: app_config)
    monkeypatch.setattr("app.gateway.routers.auth._get_oidc_service", lambda: oidc_service)

    context = await resolve_scheduled_task_authorization(
        str(user.id),
        context_mode="reuse_thread",
        thread_id="thread-42",
        thread_store=thread_store,
    )

    local_provider.get_user.assert_awaited_once_with(str(user.id))
    load_active_credentials.assert_awaited_once_with(
        user=user,
        provider_configs=provider_configs,
        oidc_service=oidc_service,
    )
    thread_store.check_access.assert_awaited_once_with("thread-42", str(user.id), require_existing=True)
    assert context.user is user
    assert context.authz_attributes is authz_attributes
    assert [call.kwargs["target"] for call in scope_check.await_args_list] == [
        "threads:write",
        "runs:create",
        "threads:read",
        "threads:write",
    ]
    assert scope_check.await_args_list[2].kwargs["resource_id"] == "thread-42"
    assert scope_check.await_args_list[3].kwargs["resource_id"] == "thread-42"


@pytest.mark.asyncio
async def test_scheduled_task_authorization_fails_closed_without_active_iam_session(monkeypatch):
    user = _user(is_active=True)
    central_provider = SimpleNamespace(name="central-iam", requires_iam_identity=True)
    monkeypatch.setattr("app.gateway.authz._get_route_authorization_config", lambda: AuthorizationConfig(enabled=True))
    monkeypatch.setattr("app.gateway.authz._get_cached_route_provider", lambda _config: central_provider)
    monkeypatch.setattr("app.gateway.deps.get_local_provider", lambda: SimpleNamespace(get_user=AsyncMock(return_value=user)))
    load_active_credentials = AsyncMock(return_value={})
    monkeypatch.setattr(
        "app.gateway.auth.iam_token_vault.load_active_iam_authorization_attributes",
        load_active_credentials,
        raising=False,
    )
    monkeypatch.setattr(
        "deerflow.config.app_config.get_app_config",
        lambda: SimpleNamespace(auth=SimpleNamespace(oidc=SimpleNamespace(providers={"github": object()}))),
    )
    monkeypatch.setattr("app.gateway.routers.auth._get_oidc_service", lambda: object())

    with pytest.raises(HTTPException) as denied:
        await resolve_scheduled_task_authorization(
            str(user.id),
            context_mode="fresh_thread_per_run",
            thread_id=None,
            thread_store=SimpleNamespace(check_access=AsyncMock()),
        )

    assert denied.value.status_code == 403
    load_active_credentials.assert_awaited_once()


@pytest.mark.asyncio
async def test_route_permissions_use_async_provider_and_trusted_principal(monkeypatch):
    provider = _RecordingProvider(denied={Permissions.THREADS_DELETE, Permissions.RUNS_CANCEL})
    _enable_authorization(monkeypatch, provider)

    permissions = await resolve_route_permissions(_user(), is_internal=True)

    denied = {Permissions.THREADS_DELETE, Permissions.RUNS_CANCEL}
    assert permissions == [permission for permission in _EXPECTED_ROUTE_PERMISSIONS if permission not in denied]
    assert [(request.resource, request.action, request.target) for request in provider.requests] == [("route", permission.partition(":")[2], permission) for permission in _EXPECTED_ROUTE_PERMISSIONS]
    principal = provider.requests[0].principal
    assert principal.user_id == "user-123"
    assert principal.role == "user"
    assert principal.oauth_provider == "github"
    assert principal.oauth_id == "oauth-456"
    assert principal.is_internal is True


@pytest.mark.asyncio
async def test_route_permissions_fail_closed_denies_only_the_failed_permission(monkeypatch):
    provider = _RecordingProvider(errors={Permissions.RUNS_CANCEL})
    _enable_authorization(monkeypatch, provider, fail_closed=True)

    permissions = await resolve_route_permissions(_user(), is_internal=False)

    assert permissions == [permission for permission in _EXPECTED_ROUTE_PERMISSIONS if permission != Permissions.RUNS_CANCEL]


@pytest.mark.asyncio
async def test_route_permissions_fail_open_allows_the_failed_permission(monkeypatch):
    provider = _RecordingProvider(errors={Permissions.RUNS_CANCEL})
    _enable_authorization(monkeypatch, provider, fail_closed=False)

    permissions = await resolve_route_permissions(_user(), is_internal=False)

    assert permissions == _EXPECTED_ROUTE_PERMISSIONS


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fail_closed", "expected"),
    [
        (True, []),
        (False, _EXPECTED_ROUTE_PERMISSIONS),
    ],
)
async def test_route_permissions_apply_failure_mode_to_provider_resolution(monkeypatch, fail_closed, expected):
    config = AuthorizationConfig(
        enabled=True,
        fail_closed=fail_closed,
        default_role="user",
    )
    monkeypatch.setattr("app.gateway.authz._get_route_authorization_config", lambda: config)

    def fail_cached(c):
        raise ValueError("invalid provider configuration")

    monkeypatch.setattr("app.gateway.authz._get_cached_route_provider", fail_cached)

    assert await resolve_route_permissions(_user(), is_internal=False) == expected


@pytest.mark.asyncio
async def test_route_permissions_use_builtin_rbac_route_policy(monkeypatch):
    provider = RbacAuthorizationProvider(
        roles={
            "user": {
                "routes": {
                    "allow": [Permissions.THREADS_READ, Permissions.RUNS_READ],
                }
            }
        }
    )
    _enable_authorization(monkeypatch, provider)

    permissions = await resolve_route_permissions(_user(), is_internal=False)

    assert permissions == [Permissions.THREADS_READ, Permissions.RUNS_READ]


@pytest.mark.asyncio
async def test_authenticate_uses_route_permission_resolution(monkeypatch):
    user = User(email="route-authz@example.com", password_hash="hash")
    permission_resolver = AsyncMock(return_value=[Permissions.THREADS_READ])
    monkeypatch.setattr("app.gateway.deps.get_optional_user_from_request", AsyncMock(return_value=user))
    monkeypatch.setattr("app.gateway.authz.resolve_route_permissions_for_request", permission_resolver)
    request = SimpleNamespace(state=SimpleNamespace())

    auth_context = await _authenticate(request)

    assert auth_context.user is user
    assert auth_context.permissions == [Permissions.THREADS_READ]
    permission_resolver.assert_awaited_once()
    assert permission_resolver.await_args.args[1] is user


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("handler_name", "required_permission"),
    [
        ("list_agents", Permissions.AGENTS_READ),
        ("create_agent_endpoint", Permissions.AGENTS_WRITE),
        ("delete_agent", Permissions.AGENTS_DELETE),
        ("get_user_profile", Permissions.AGENTS_ADMIN),
        ("update_user_profile", Permissions.AGENTS_ADMIN),
    ],
)
async def test_agent_management_denial_happens_before_handler(monkeypatch, handler_name, required_permission):
    from app.gateway.routers import agents

    # A stub request with a real authenticated context exercises the actual
    # route decorator without starting ASGI sockets or touching agent storage.
    request = SimpleNamespace(state=SimpleNamespace(auth=AuthContext(user=_user(), permissions=[])))
    handler = getattr(agents, handler_name)
    monkeypatch.setattr(agents, "_require_agents_api_enabled", MagicMock(side_effect=AssertionError("denied route reached handler")))

    kwargs = {"http_request": request}
    if handler_name == "create_agent_endpoint":
        kwargs["request"] = agents.AgentCreateRequest(name="no-access")
    elif handler_name == "update_user_profile":
        kwargs["request"] = agents.UserProfileUpdateRequest(content="must not be written")
    elif handler_name == "delete_agent":
        kwargs["name"] = "no-access"

    with pytest.raises(HTTPException) as exc_info:
        await handler(**kwargs)

    assert exc_info.value.status_code == 403
    assert required_permission in exc_info.value.detail


def _make_middleware_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(AuthMiddleware)

    @app.get("/api/threads")
    @require_permission("threads", "read")
    async def read_threads(request: Request):
        return {"ok": True}

    @app.delete("/api/threads")
    @require_permission("threads", "delete")
    async def delete_threads(request: Request):
        return {"ok": True}

    return app


def test_auth_middleware_stamps_provider_derived_permissions(monkeypatch):
    monkeypatch.setenv("DEER_FLOW_AUTH_DISABLED", "1")
    permission_resolver = AsyncMock(return_value=[Permissions.THREADS_READ])
    monkeypatch.setattr("app.gateway.auth_middleware.resolve_route_permissions_for_request", permission_resolver)

    with TestClient(_make_middleware_app()) as client:
        assert client.get("/api/threads").status_code == 200
        assert client.delete("/api/threads").status_code == 403

    assert permission_resolver.await_count == 2
    assert all(call.args[0].url.path == "/api/threads" for call in permission_resolver.await_args_list)


def test_auth_middleware_marks_internal_route_principal(monkeypatch):
    from app.gateway.internal_auth import create_internal_auth_headers

    permission_resolver = AsyncMock(return_value=[Permissions.THREADS_READ])
    monkeypatch.setattr("app.gateway.auth_middleware.resolve_route_permissions_for_request", permission_resolver)

    with TestClient(_make_middleware_app()) as client:
        response = client.get("/api/threads", headers=create_internal_auth_headers())

    assert response.status_code == 200
    permission_resolver.assert_awaited_once()
    assert permission_resolver.await_args.args[0].state.auth_source == "internal"


@pytest.mark.asyncio
async def test_request_route_authorization_loads_iam_credentials_only_for_iam_provider(monkeypatch):
    provider = _RecordingProvider()
    provider.name = "central-iam"
    _enable_authorization(monkeypatch, provider)
    credentials = {"iam_credentials": SimpleNamespace(__repr__=lambda self: "credentials(<redacted>)")}
    resolver = AsyncMock(return_value=credentials)
    monkeypatch.setattr("app.gateway.auth.iam_token_vault.load_iam_authorization_attributes", resolver)
    monkeypatch.setattr("app.gateway.routers.auth._get_oidc_service", lambda: object())
    monkeypatch.setattr(
        "deerflow.config.app_config.get_app_config",
        lambda: SimpleNamespace(auth=SimpleNamespace(oidc=SimpleNamespace(providers={"iam": object()}))),
    )
    user = _user(oauth_provider="iam")
    request = SimpleNamespace(state=SimpleNamespace(iam_session_id="11111111-1111-4111-8111-111111111111"), headers={})

    permissions = await resolve_route_permissions_for_request(request, user)

    assert permissions == _EXPECTED_ROUTE_PERMISSIONS
    assert len(provider.requests) == len(_EXPECTED_ROUTE_PERMISSIONS)
    resolver.assert_awaited_once()
    assert resolver.await_args.kwargs["session_id"] == request.state.iam_session_id
    assert request.state.iam_authz_attributes is credentials
    assert provider.requests[0].principal.attributes["iam_credentials"] is credentials["iam_credentials"]


@pytest.mark.asyncio
async def test_request_route_authorization_does_not_load_iam_credentials_for_other_provider(monkeypatch):
    provider = _RecordingProvider()
    _enable_authorization(monkeypatch, provider)
    resolver = AsyncMock(side_effect=AssertionError("non-IAM providers must not access the token vault"))
    monkeypatch.setattr("app.gateway.auth.iam_token_vault.load_iam_authorization_attributes", resolver)
    request = SimpleNamespace(state=SimpleNamespace(), headers={})

    await resolve_route_permissions_for_request(request, _user())

    resolver.assert_not_awaited()


_STATELESS_RUN_PATHS = ("/api/runs/stream", "/api/runs/wait")


def _enable_auth_disabled_for_route_test(monkeypatch) -> None:
    monkeypatch.setenv("DEER_FLOW_AUTH_DISABLED", "1")
    monkeypatch.delenv("DEER_FLOW_ENV", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)


def _make_stateless_runs_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(AuthMiddleware)
    app.include_router(runs.router)
    app.state.stream_bridge = MagicMock()
    app.state.run_manager = MagicMock()
    return app


@pytest.mark.parametrize("path", _STATELESS_RUN_PATHS)
def test_stateless_run_creation_requires_runs_create(monkeypatch, path):
    _enable_auth_disabled_for_route_test(monkeypatch)
    monkeypatch.setattr(
        "app.gateway.auth_middleware.resolve_route_permissions_for_request",
        AsyncMock(return_value=[Permissions.RUNS_READ]),
    )
    start_run = AsyncMock(side_effect=HTTPException(status_code=418, detail="run creation reached"))
    monkeypatch.setattr(runs, "start_run", start_run)

    with TestClient(_make_stateless_runs_app()) as client:
        response = client.post(path, json={})

    assert response.status_code == 403
    assert response.json() == {"detail": "Permission denied: runs:create"}
    start_run.assert_not_awaited()


@pytest.mark.parametrize("path", _STATELESS_RUN_PATHS)
def test_stateless_run_creation_allows_runs_create(monkeypatch, path):
    _enable_auth_disabled_for_route_test(monkeypatch)
    monkeypatch.setattr(
        "app.gateway.auth_middleware.resolve_route_permissions_for_request",
        AsyncMock(return_value=[Permissions.RUNS_CREATE]),
    )
    start_run = AsyncMock(side_effect=HTTPException(status_code=418, detail="run creation reached"))
    monkeypatch.setattr(runs, "start_run", start_run)

    with TestClient(_make_stateless_runs_app()) as client:
        response = client.post(path, json={})

    assert response.status_code == 418
    assert response.json() == {"detail": "run creation reached"}
    start_run.assert_awaited_once()


@pytest.mark.parametrize("path", _STATELESS_RUN_PATHS)
def test_stateless_run_creation_requires_iam_scope_before_start_run(monkeypatch, path):
    _enable_auth_disabled_for_route_test(monkeypatch)
    monkeypatch.setattr(
        "app.gateway.auth_middleware.resolve_route_permissions_for_request",
        AsyncMock(return_value=[Permissions.RUNS_CREATE]),
    )
    scope_check = AsyncMock(side_effect=HTTPException(status_code=403, detail="scope denied"))
    monkeypatch.setattr(runs, "require_iam_data_scope_for_request", scope_check)
    start_run = AsyncMock(side_effect=HTTPException(status_code=418, detail="run creation reached"))
    monkeypatch.setattr(runs, "start_run", start_run)

    with TestClient(_make_stateless_runs_app()) as client:
        response = client.post(path, json={})

    assert response.status_code == 403
    assert response.json() == {"detail": "scope denied"}
    scope_check.assert_awaited_once()
    assert scope_check.await_args.kwargs == {"target": "runs:create", "action": "create"}
    start_run.assert_not_awaited()


_SCHEDULED_RUN_CREATION_REQUESTS = (
    (
        "POST",
        "/api/scheduled-tasks",
        {
            "title": "Daily summary",
            "prompt": "Summarize the latest activity",
            "schedule_type": "cron",
            "schedule_spec": {"cron": "0 9 * * *"},
            "timezone": "UTC",
        },
    ),
    ("PATCH", "/api/scheduled-tasks/task-1", {"title": "Updated summary"}),
    ("POST", "/api/scheduled-tasks/task-1/resume", None),
    ("POST", "/api/scheduled-tasks/task-1/trigger", None),
)


def _make_scheduled_tasks_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(AuthMiddleware)
    app.include_router(scheduled_tasks.router)
    return app


@pytest.mark.parametrize(("method", "path", "payload"), _SCHEDULED_RUN_CREATION_REQUESTS)
@pytest.mark.parametrize(
    ("permissions", "denied_permission"),
    [
        ([Permissions.THREADS_WRITE], Permissions.RUNS_CREATE),
        ([Permissions.RUNS_CREATE], Permissions.THREADS_WRITE),
    ],
)
def test_scheduled_run_creation_requires_thread_write_and_runs_create(monkeypatch, method, path, payload, permissions, denied_permission):
    _enable_auth_disabled_for_route_test(monkeypatch)
    monkeypatch.setattr(
        "app.gateway.auth_middleware.resolve_route_permissions_for_request",
        AsyncMock(return_value=permissions),
    )

    with TestClient(_make_scheduled_tasks_app()) as client:
        response = client.request(method, path, json=payload)

    assert response.status_code == 403
    assert response.json() == {"detail": f"Permission denied: {denied_permission}"}


def test_scheduled_task_delete_requires_thread_delete(monkeypatch):
    _enable_auth_disabled_for_route_test(monkeypatch)
    monkeypatch.setattr(
        "app.gateway.auth_middleware.resolve_route_permissions_for_request",
        AsyncMock(return_value=[Permissions.THREADS_WRITE]),
    )

    with TestClient(_make_scheduled_tasks_app()) as client:
        response = client.delete("/api/scheduled-tasks/task-1")

    assert response.status_code == 403
    assert response.json() == {"detail": f"Permission denied: {Permissions.THREADS_DELETE}"}


def test_scheduled_task_run_history_requires_run_read(monkeypatch):
    _enable_auth_disabled_for_route_test(monkeypatch)
    monkeypatch.setattr(
        "app.gateway.auth_middleware.resolve_route_permissions_for_request",
        AsyncMock(return_value=[Permissions.THREADS_READ]),
    )

    with TestClient(_make_scheduled_tasks_app()) as client:
        response = client.get("/api/scheduled-tasks/task-1/runs")

    assert response.status_code == 403
    assert response.json() == {"detail": f"Permission denied: {Permissions.RUNS_READ}"}


# ── Provider cache tests ────────────────────────────────────────────────


class TestRouteProviderCache:
    """Verify the provider cache returns the same instance for unchanged config
    and re-resolves when config content changes."""

    def test_same_config_returns_same_provider(self):
        """Calling twice with the same config object returns the same instance."""
        import app.gateway.authz as authz_module

        # Reset cache
        authz_module._route_provider_cache.clear()
        authz_module._route_provider_config_id = None
        authz_module._route_provider_config_sig = None

        config = AuthorizationConfig(
            enabled=True,
            provider=AuthorizationProviderConfig(
                use="deerflow.authz.rbac:RbacAuthorizationProvider",
                config={"roles": {"user": {"routes": {"allow": "*"}}}},
            ),
        )

        p1 = _get_cached_route_provider(config)
        p2 = _get_cached_route_provider(config)
        assert p1 is not None
        assert p2 is p1

    def test_changed_config_returns_new_provider(self):
        """A config with different content triggers re-resolution."""
        import app.gateway.authz as authz_module

        authz_module._route_provider_cache.clear()
        authz_module._route_provider_config_id = None
        authz_module._route_provider_config_sig = None

        config1 = AuthorizationConfig(
            enabled=True,
            provider=AuthorizationProviderConfig(
                use="deerflow.authz.rbac:RbacAuthorizationProvider",
                config={"roles": {"user": {"routes": {"allow": "*"}}}},
            ),
        )
        config2 = AuthorizationConfig(
            enabled=True,
            provider=AuthorizationProviderConfig(
                use="deerflow.authz.rbac:RbacAuthorizationProvider",
                config={"roles": {"user": {"routes": {"allow": []}}}},
            ),
        )

        p1 = _get_cached_route_provider(config1)
        p2 = _get_cached_route_provider(config2)
        assert p1 is not None
        assert p2 is not None
        assert p1 is not p2

    def test_same_content_different_object_reuses_provider(self):
        """Same content in a new object (e.g. hot-reload with no changes) reuses provider."""
        import app.gateway.authz as authz_module

        authz_module._route_provider_cache.clear()
        authz_module._route_provider_config_id = None
        authz_module._route_provider_config_sig = None

        config1 = AuthorizationConfig(
            enabled=True,
            provider=AuthorizationProviderConfig(
                use="deerflow.authz.rbac:RbacAuthorizationProvider",
                config={"roles": {"user": {"routes": {"allow": "*"}}}},
            ),
        )
        # Same content, different object
        config2 = AuthorizationConfig(
            enabled=True,
            provider=AuthorizationProviderConfig(
                use="deerflow.authz.rbac:RbacAuthorizationProvider",
                config={"roles": {"user": {"routes": {"allow": "*"}}}},
            ),
        )

        p1 = _get_cached_route_provider(config1)
        p2 = _get_cached_route_provider(config2)
        assert p1 is p2
