from __future__ import annotations

from types import SimpleNamespace

import pytest

from deerflow.agents.memory.authorization import is_memory_scope_authorized, is_memory_scope_authorized_sync
from deerflow.authz.principal import bind_run_authorization_credentials, reset_run_authorization_credentials
from deerflow.config.authorization_config import AuthorizationConfig, AuthorizationProviderConfig


class _Provider:
    name = "central-iam"
    requires_iam_identity = True

    def __init__(self, decision):
        self.decision = decision
        self.requests = []

    def resolve_data_scope(self, principal, *, resource, action, target, context=None):
        self.requests.append((principal, resource, action, target, context))
        return self.decision

    async def aresolve_data_scope(self, principal, *, resource, action, target, context=None):
        self.requests.append((principal, resource, action, target, context))
        return self.decision


def _runtime_context(*, user_id="local-user-1", subject="iam-subject-1", tenant="tenant-1"):
    return {
        "user_id": user_id,
        "user_role": "user",
        "oauth_provider": "central-iam",
        "oauth_id": subject,
        "authz_attributes": {
            "iam_credentials": {
                "iam_access_token": "opaque-token",
                "iam_subject": subject,
                "iam_tenant_id": tenant,
            }
        },
    }


def _decision(scope, *, allow=True):
    return SimpleNamespace(allow=allow, reasons=[], policy_id="central-iam", metadata={"data_scope": scope})


def _config(*, enabled=True):
    return AuthorizationConfig(
        enabled=enabled,
        fail_closed=True,
        default_role="user",
        provider=AuthorizationProviderConfig(use="unused:Provider", config={}),
    )


@pytest.fixture
def iam_capability():
    """Mirror the server-only run capability bound by the Gateway worker."""
    token = bind_run_authorization_credentials(
        {
            "iam_access_token": "opaque-token",
            "iam_subject": "iam-subject-1",
            "iam_tenant_id": "tenant-1",
        }
    )
    try:
        yield
    finally:
        reset_run_authorization_credentials(token)


@pytest.mark.asyncio
async def test_memory_scope_requires_exact_owner_branch_and_checks_each_action(iam_capability):
    provider = _Provider(
        _decision(
            {
                "mode": "any_of",
                "constraints": [
                    {
                        "kind": "owner",
                        "field": "owner_user_id",
                        "user_id": "iam-subject-1",
                        "tenant_id": "tenant-1",
                    }
                ],
            }
        )
    )

    allowed = await is_memory_scope_authorized(
        _runtime_context(),
        local_user_id="local-user-1",
        actions=("read", "write"),
        authorization_config=_config(),
        provider=provider,
    )

    assert allowed is True
    assert [(call[1], call[2], call[3]) for call in provider.requests] == [
        ("route", "read", "memory:read"),
        ("route", "write", "memory:write"),
    ]
    assert all(call[0].user_id == "local-user-1" for call in provider.requests)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "scope",
    [
        None,
        {"mode": "any_of", "constraints": []},
        {
            "mode": "any_of",
            "constraints": [{"kind": "owner", "field": "owner_user_id", "user_id": "someone-else", "tenant_id": "tenant-1"}],
        },
        {
            "mode": "any_of",
            "constraints": [{"kind": "tenant", "tenant_id": "tenant-1"}],
        },
        {
            "mode": "any_of",
            "constraints": [{"kind": "owner", "field": "owner_user_id", "user_id": "iam-subject-1", "tenant_id": "other-tenant"}],
        },
    ],
)
async def test_memory_scope_fails_closed_for_missing_or_broader_scope(scope, iam_capability):
    provider = _Provider(_decision(scope))

    allowed = await is_memory_scope_authorized(
        _runtime_context(),
        local_user_id="local-user-1",
        actions=("write",),
        authorization_config=_config(),
        provider=provider,
    )

    assert allowed is False


@pytest.mark.asyncio
async def test_memory_scope_fails_closed_when_local_owner_does_not_match_runtime_identity():
    provider = _Provider(_decision({"mode": "any_of", "constraints": []}))

    allowed = await is_memory_scope_authorized(
        _runtime_context(),
        local_user_id="different-local-user",
        actions=("write",),
        authorization_config=_config(),
        provider=provider,
    )

    assert allowed is False
    assert provider.requests == []


@pytest.mark.asyncio
async def test_memory_scope_does_not_trust_credentials_from_serialized_runtime_context():
    provider = _Provider(
        _decision(
            {
                "mode": "any_of",
                "constraints": [
                    {
                        "kind": "owner",
                        "field": "owner_user_id",
                        "user_id": "iam-subject-1",
                        "tenant_id": "tenant-1",
                    }
                ],
            }
        )
    )

    allowed = await is_memory_scope_authorized(
        _runtime_context(),
        local_user_id="local-user-1",
        actions=("write",),
        authorization_config=_config(),
        provider=provider,
    )

    assert allowed is False
    assert provider.requests == []


@pytest.mark.asyncio
async def test_sync_scope_check_uses_run_capability_inside_running_event_loop(iam_capability, monkeypatch):
    provider = _Provider(
        _decision(
            {
                "mode": "any_of",
                "constraints": [
                    {
                        "kind": "owner",
                        "field": "owner_user_id",
                        "user_id": "iam-subject-1",
                        "tenant_id": "tenant-1",
                    }
                ],
            }
        )
    )
    monkeypatch.setattr(
        "deerflow.agents.memory.authorization.resolve_authorization_provider",
        lambda config: provider,
    )
    monkeypatch.setattr(
        "deerflow.agents.memory.authorization.get_app_config",
        lambda: SimpleNamespace(authorization=_config()),
    )

    allowed = is_memory_scope_authorized_sync(
        _runtime_context(),
        local_user_id="local-user-1",
        actions=("read",),
    )

    assert allowed is True
    assert len(provider.requests) == 1


@pytest.mark.asyncio
async def test_memory_scope_uses_existing_local_provider_behavior_without_central_iam():
    provider = SimpleNamespace(name="rbac", requires_iam_identity=False)

    allowed = await is_memory_scope_authorized(
        _runtime_context(),
        local_user_id="local-user-1",
        actions=("read",),
        authorization_config=_config(),
        provider=provider,
    )

    assert allowed is True


@pytest.mark.asyncio
async def test_memory_scope_keeps_legacy_behavior_when_authorization_is_disabled():
    allowed = await is_memory_scope_authorized(
        {},
        local_user_id="default",
        actions=("write",),
        authorization_config=_config(enabled=False),
        provider=None,
    )

    assert allowed is True
