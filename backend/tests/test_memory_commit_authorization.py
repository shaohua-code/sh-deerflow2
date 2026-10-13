from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.gateway import authz
from app.gateway import memory_authorization as memory_auth
from deerflow.config.authorization_config import AuthorizationConfig


class _CentralIamProvider:
    name = "central-iam"
    requires_iam_identity = True

    def __init__(self, *, allow: bool = True, scope: dict | None = None):
        self.allow = allow
        self.scope = scope or {
            "mode": "any_of",
            "constraints": [
                {
                    "kind": "owner",
                    "field": "owner_user_id",
                    "user_id": "subject-1",
                    "tenant_id": "tenant-1",
                }
            ],
        }
        self.requests = []

    async def aresolve_data_scope(self, principal, *, resource, action, target, context=None):
        self.requests.append((principal, resource, action, target, context))
        return SimpleNamespace(allow=self.allow, metadata={"data_scope": self.scope})


def _configure_gateway(monkeypatch, *, user=None, provider=None, attributes=None):
    from app.gateway import deps
    from app.gateway.auth import iam_token_vault
    from app.gateway.routers import auth as auth_router
    from deerflow.config import app_config

    resolved_user = user or SimpleNamespace(
        id="local-user-1",
        is_active=True,
        oauth_provider="iam",
        oauth_id="subject-1",
        system_role="user",
    )
    resolved_provider = provider or _CentralIamProvider()
    monkeypatch.setattr(authz, "_get_route_authorization_config", lambda: AuthorizationConfig(enabled=True))
    monkeypatch.setattr(authz, "_get_cached_route_provider", lambda _config: resolved_provider)

    class _UserProvider:
        async def get_user(self, user_id: str):
            return resolved_user if user_id == str(resolved_user.id) else None

    monkeypatch.setattr(deps, "get_local_provider", lambda: _UserProvider())

    async def load_attributes(**kwargs):
        assert kwargs["user"] is resolved_user
        return (
            attributes
            if attributes is not None
            else {
                "iam_credentials": {
                    "iam_access_token": "opaque-test-token",
                    "iam_subject": "subject-1",
                    "iam_tenant_id": "tenant-1",
                }
            }
        )

    monkeypatch.setattr(iam_token_vault, "load_active_iam_authorization_attributes", load_attributes)
    monkeypatch.setattr(auth_router, "_get_oidc_service", lambda: object())
    monkeypatch.setattr(
        app_config,
        "get_app_config",
        lambda: SimpleNamespace(auth=SimpleNamespace(oidc=SimpleNamespace(providers={}))),
    )
    return resolved_user, resolved_provider


@pytest.mark.asyncio
async def test_sync_worker_bridges_to_gateway_loop_and_passes_only_local_user_id(monkeypatch):
    provider = _CentralIamProvider()
    monkeypatch.setattr(authz, "_get_route_authorization_config", lambda: AuthorizationConfig(enabled=True))
    monkeypatch.setattr(authz, "_get_cached_route_provider", lambda _config: provider)
    seen_user_ids: list[str] = []

    async def authorize(user_id: str) -> bool:
        seen_user_ids.append(user_id)
        return True

    monkeypatch.setattr(memory_auth, "_authorize_memory_write", authorize)
    loop = asyncio.get_running_loop()
    memory_auth.set_memory_authorization_loop(loop)
    try:
        result = await asyncio.to_thread(
            memory_auth.authorize_memory_write,
            user_id="local-user-1",
            thread_id="thread-1",
            agent_name="agent-1",
        )
    finally:
        memory_auth.reset_memory_authorization_loop(loop)

    assert result is True
    assert seen_user_ids == ["local-user-1"]


@pytest.mark.asyncio
async def test_commit_authorization_reloads_identity_and_checks_exact_read_write_scopes(monkeypatch):
    user, provider = _configure_gateway(monkeypatch)

    assert await memory_auth._authorize_memory_write("local-user-1") is True

    assert [(call[1], call[2], call[3]) for call in provider.requests] == [
        ("route", "read", "memory:read"),
        ("route", "write", "memory:write"),
    ]
    assert all(call[0].user_id == str(user.id) for call in provider.requests)
    assert all(call[0].oauth_id == user.oauth_id for call in provider.requests)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider, user, attributes",
    [
        (
            _CentralIamProvider(scope={"mode": "any_of", "constraints": [{"kind": "tenant", "tenant_id": "tenant-1"}]}),
            None,
            None,
        ),
        (_CentralIamProvider(allow=False), None, None),
        (
            _CentralIamProvider(),
            SimpleNamespace(id="local-user-1", is_active=False, oauth_provider="iam", oauth_id="subject-1", system_role="user"),
            None,
        ),
        (
            _CentralIamProvider(),
            None,
            {"iam_credentials": {"iam_access_token": "token", "iam_subject": "other-subject", "iam_tenant_id": "tenant-1"}},
        ),
    ],
)
async def test_commit_authorization_fails_closed_for_denial_broad_scope_inactive_user_or_identity_mismatch(monkeypatch, provider, user, attributes):
    _, resolved_provider = _configure_gateway(monkeypatch, user=user, provider=provider, attributes=attributes)

    assert await memory_auth._authorize_memory_write("local-user-1") is False
    if user is not None and not user.is_active:
        assert resolved_provider.requests == []


@pytest.mark.asyncio
async def test_commit_authorization_fails_closed_without_active_vault_session(monkeypatch):
    user = SimpleNamespace(
        id="local-user-1",
        is_active=True,
        oauth_provider="iam",
        oauth_id="subject-1",
        system_role="user",
    )
    _configure_gateway(monkeypatch, user=user, attributes={})

    assert await memory_auth._authorize_memory_write("local-user-1") is False


@pytest.mark.asyncio
async def test_memory_usage_callback_reloads_active_vault_and_pins_default_profile(monkeypatch):
    from app.gateway import deps
    from app.gateway.auth import iam_token_vault
    from app.gateway.routers import auth as auth_router
    from deerflow.authz import iam_model_usage_callback
    from deerflow.config import app_config as app_config_module

    user, _provider = _configure_gateway(monkeypatch)
    profile = SimpleNamespace(name="gpt-4o")
    authorization_provider = SimpleNamespace(
        use="deerflow.authz.iam_deerflow:DeerFlowIamAuthorizationProvider",
        config={"model_usage": {"enabled": True}},
    )
    configured = SimpleNamespace(
        authorization=SimpleNamespace(enabled=True, provider=authorization_provider),
        auth=SimpleNamespace(oidc=SimpleNamespace(providers={"iam": object()})),
        models=[profile],
    )
    monkeypatch.setattr(app_config_module, "get_app_config", lambda: configured)
    credentials = {
        "iam_access_token": "opaque-test-token",
        "iam_subject": "subject-1",
        "iam_tenant_id": "tenant-1",
    }
    loaded = []

    async def load_attributes(**kwargs):
        loaded.append(kwargs["user"])
        return {"iam_credentials": credentials}

    monkeypatch.setattr(iam_token_vault, "load_active_iam_authorization_attributes", load_attributes)
    monkeypatch.setattr(auth_router, "_get_oidc_service", lambda: object())

    class _UserProvider:
        async def get_user(self, user_id: str):
            return _resolved_user() if user_id == "local-user-1" else None

    monkeypatch.setattr(deps, "get_local_provider", lambda: _UserProvider())
    bound_profiles = []
    handler = object()
    parent = SimpleNamespace(for_model=lambda name: (bound_profiles.append(name), handler)[1])
    builder_calls = []

    def build_usage_callback(app_config, received_credentials):
        builder_calls.append((app_config, received_credentials))
        return parent

    monkeypatch.setattr(iam_model_usage_callback, "build_iam_model_usage_callback", build_usage_callback)

    result = await memory_auth._build_memory_model_usage_callback("local-user-1", None)

    assert result is handler
    assert loaded == [user]
    assert builder_calls == [(configured, credentials)]
    assert bound_profiles == ["gpt-4o"]


def _resolved_user():
    return SimpleNamespace(id="local-user-1", is_active=True, oauth_provider="iam", oauth_id="subject-1", system_role="user")


def test_memory_queue_context_has_no_iam_credential_fields():
    from dataclasses import fields

    from deerflow.agents.memory.backends.deermem.deermem.core.queue import ConversationContext

    context_fields = {field.name for field in fields(ConversationContext)}
    assert "user_id" in context_fields
    assert "thread_id" in context_fields
    assert not context_fields.intersection({"access_token", "refresh_token", "iam_credentials", "authz_attributes", "authorization_credentials"})
