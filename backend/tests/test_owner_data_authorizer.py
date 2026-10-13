"""Gateway owner-data jobs must resolve current account and policy each time."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from deerflow_extension_api import OwnerDataAuthorizationError, OwnerDataScope

from app.gateway.owner_data_authorizer import GatewayOwnerDataAuthorizer
from deerflow.authz.provider import AuthzDecision


class _ActiveUser:
    id = "user-1"
    is_active = True
    system_role = "user"
    oauth_provider = "corp"
    oauth_id = "subject-1"


class _LocalProvider:
    async def get_user(self, user_id: str):
        assert user_id == "user-1"
        return _ActiveUser()


class _AllowProvider:
    name = "test-provider"

    async def aauthorize(self, request):
        assert request.resource == "route"
        return AuthzDecision(allow=True)


def _install_gateway_stubs(monkeypatch, *, provider, enabled=True):
    from app.gateway import authz, deps

    config = SimpleNamespace(enabled=enabled, default_role="user")
    monkeypatch.setattr(deps, "get_local_provider", lambda: _LocalProvider())
    monkeypatch.setattr(authz, "_get_route_authorization_config", lambda: config)
    monkeypatch.setattr(authz, "_get_cached_route_provider", lambda _config: provider)
    return authz


def test_worker_authorizer_checks_route_grants_and_owner_scope(monkeypatch) -> None:
    authz = _install_gateway_stubs(monkeypatch, provider=_AllowProvider())
    scope_calls = []

    async def allow_data_scope(request, user, **kwargs):
        scope_calls.append((request, user, kwargs))

    monkeypatch.setattr(authz, "require_iam_data_scope_for_request", allow_data_scope)
    scope = OwnerDataScope("threads:read", "read", "thread-1")

    asyncio.run(GatewayOwnerDataAuthorizer().authorize(user_id="user-1", scopes=(scope,)))

    assert len(scope_calls) == 1
    request, user, kwargs = scope_calls[0]
    assert user.id == "user-1"
    assert request.state.iam_authz_attributes == {}
    assert kwargs == {
        "target": "threads:read",
        "action": "read",
        "resource_id": "thread-1",
    }


def test_worker_authorizer_stops_before_data_scope_when_route_is_denied(monkeypatch) -> None:
    class DenyProvider(_AllowProvider):
        async def aauthorize(self, _request):
            return AuthzDecision(allow=False)

    authz = _install_gateway_stubs(monkeypatch, provider=DenyProvider())
    scope_calls = []

    async def allow_data_scope(*_args, **_kwargs):
        scope_calls.append(True)

    monkeypatch.setattr(authz, "require_iam_data_scope_for_request", allow_data_scope)

    with pytest.raises(OwnerDataAuthorizationError) as denied:
        asyncio.run(
            GatewayOwnerDataAuthorizer().authorize(
                user_id="user-1",
                scopes=(OwnerDataScope("threads:read", "read"),),
            )
        )

    assert denied.value.status_code == 403
    assert scope_calls == []


def test_central_iam_worker_authorization_refreshes_active_vault_session(monkeypatch) -> None:
    from app.gateway import authz
    from app.gateway.auth import iam_token_vault
    from app.gateway.routers import auth as auth_router
    from deerflow.config import app_config

    class CentralProvider(_AllowProvider):
        name = "central-iam"
        requires_iam_identity = True

    _install_gateway_stubs(monkeypatch, provider=CentralProvider())
    refresh_calls = []
    scope_calls = []
    credentials = object()

    async def load_active(**kwargs):
        refresh_calls.append(kwargs["user"])
        return {"iam_credentials": credentials}

    async def allow_data_scope(request, user, **kwargs):
        scope_calls.append((request.state.iam_authz_attributes, user, kwargs))

    monkeypatch.setattr(iam_token_vault, "load_active_iam_authorization_attributes", load_active)
    monkeypatch.setattr(auth_router, "_get_oidc_service", lambda: object())
    monkeypatch.setattr(
        app_config,
        "get_app_config",
        lambda: SimpleNamespace(auth=SimpleNamespace(oidc=SimpleNamespace(providers={"corp": object()}))),
    )
    monkeypatch.setattr(authz, "require_iam_data_scope_for_request", allow_data_scope)
    scope = OwnerDataScope("threads:read", "read")
    authorizer = GatewayOwnerDataAuthorizer()

    asyncio.run(authorizer.authorize(user_id="user-1", scopes=(scope,)))
    asyncio.run(authorizer.authorize(user_id="user-1", scopes=(scope,)))

    assert len(refresh_calls) == 2
    assert len(scope_calls) == 2
    assert all(call[0]["iam_credentials"] is credentials for call in scope_calls)
