"""Compatibility tests for the centrally managed IAM provider."""

from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.gateway import authz as gateway_authz
from deerflow.authz.iam_authorization import AuthorizationDecision
from deerflow.authz.iam_deerflow import DeerFlowIamAuthorizationProvider
from deerflow.authz.provider import AuthorizationProvider, AuthzRequest, Principal, is_authz_decision


@dataclass
class _SdkReason:
    code: str
    message: str = ""


@dataclass
class _SdkDecision:
    allow: bool
    reasons: list[_SdkReason] = field(default_factory=list)
    policy_id: str | None = "central-iam"
    metadata: dict[str, Any] = field(default_factory=dict)


def test_central_iam_provider_implements_deerflow_protocol():
    provider = DeerFlowIamAuthorizationProvider(
        api_base_url="https://iam.example.test",
        application_id="deerflow-app",
        permission_map={"route:read:projects:read": "deerflow.project.read"},
    )

    assert isinstance(provider, AuthorizationProvider)


def test_structurally_compatible_sdk_decision_is_accepted():
    assert is_authz_decision(_SdkDecision(allow=True, reasons=[_SdkReason("iam.permission.allowed")], metadata={"application_id": "deerflow-app"}))


def test_malformed_external_decision_is_rejected():
    class _BadDecision:
        allow = True

    assert not is_authz_decision(_BadDecision())


def test_central_iam_provider_authorization_result_passes_gateway_contract():
    provider = DeerFlowIamAuthorizationProvider(
        api_base_url="https://iam.example.test",
        application_id="deerflow-app",
        permission_map={"route:read:projects:read": "deerflow.project.read"},
    )
    provider.client.check = lambda **kwargs: AuthorizationDecision(
        allowed=True,
        reason="allowed",
        application_id="deerflow-app",
    )
    principal = Principal(
        oauth_provider="central-iam",
        oauth_id="iam-subject",
        attributes={
            "iam_credentials": {
                "iam_access_token": "test-access-token",
                "iam_subject": "iam-subject",
                "iam_tenant_id": "tenant-1",
            }
        },
    )

    decision = provider.authorize(AuthzRequest(principal=principal, resource="route", action="read", target="projects:read"))

    assert decision.allow is True
    assert is_authz_decision(decision)


def test_model_invoke_uses_server_configured_iam_model_uuid():
    model_id = "2f4a5214-9614-481b-a439-2da5bb578a7d"
    provider = DeerFlowIamAuthorizationProvider(
        api_base_url="https://iam.example.test",
        application_id="deerflow-app",
        permission_map={"model:use": "model.invoke"},
        model_resource_ids={"gpt-4o": model_id},
    )
    captured: dict[str, Any] = {}
    provider.client.check = lambda **kwargs: captured.update(kwargs) or AuthorizationDecision(allowed=True, reason="allowed", application_id="deerflow-app")
    principal = Principal(
        oauth_provider="central-iam",
        oauth_id="iam-subject",
        attributes={
            "iam_credentials": {
                "iam_access_token": "test-access-token",
                "iam_subject": "iam-subject",
                "iam_tenant_id": "tenant-1",
            }
        },
    )

    decision = provider.authorize(AuthzRequest(principal=principal, resource="model", action="use", target="gpt-4o"))

    assert decision.allow is True
    assert captured["permission_code"] == "model.invoke"
    assert captured["resource_id"] == model_id


def test_model_invoke_denies_unmapped_model_without_remote_request():
    provider = DeerFlowIamAuthorizationProvider(
        api_base_url="https://iam.example.test",
        application_id="deerflow-app",
        permission_map={"model:use": "model.invoke"},
    )
    provider.client.check = lambda **_kwargs: pytest.fail("unmapped models must not reach IAM")
    principal = Principal(
        oauth_provider="central-iam",
        oauth_id="iam-subject",
        attributes={
            "iam_credentials": {
                "iam_access_token": "test-access-token",
                "iam_subject": "iam-subject",
                "iam_tenant_id": "tenant-1",
            }
        },
    )

    decision = provider.authorize(AuthzRequest(principal=principal, resource="model", action="use", target="unknown"))

    assert not decision.allow
    assert decision.reasons[0].code == "iam_resource_context_invalid"


def test_tool_filter_checks_each_tool_resource_id():
    provider = DeerFlowIamAuthorizationProvider(
        api_base_url="https://iam.example.test",
        application_id="deerflow-app",
        permission_map={"tool:use": "deerflow.tool.use"},
    )
    checked: list[str | None] = []

    def check(**kwargs):
        checked.append(kwargs.get("resource_id"))
        return AuthorizationDecision(
            allowed=kwargs.get("resource_id") == "web_search",
            reason="allowed" if kwargs.get("resource_id") == "web_search" else "denied",
            application_id="deerflow-app",
        )

    provider.client.check = check
    principal = Principal(
        oauth_provider="central-iam",
        oauth_id="iam-subject",
        attributes={
            "iam_credentials": {
                "iam_access_token": "test-access-token",
                "iam_subject": "iam-subject",
                "iam_tenant_id": "tenant-1",
            }
        },
    )

    allowed = provider.filter_resources(principal, "tool", ["web_search", "bash"])

    assert allowed == ["web_search"]
    assert checked == ["web_search", "bash"]


def test_invalid_model_resource_mapping_is_rejected():
    with pytest.raises(ValueError, match="IAM model UUIDs"):
        DeerFlowIamAuthorizationProvider(
            api_base_url="https://iam.example.test",
            application_id="deerflow-app",
            permission_map={"model:use": "model.invoke"},
            model_resource_ids={"gpt-4o": "not-a-uuid"},
        )


@pytest.mark.asyncio
async def test_project_data_scope_accepts_only_the_verified_owner_scope(monkeypatch):
    class _Provider:
        name = "central-iam"
        requires_iam_identity = True

        async def aresolve_data_scope(self, principal, **kwargs):
            return SimpleNamespace(
                allow=True,
                metadata={
                    "data_scope": {
                        "mode": "any_of",
                        "constraints": [
                            {
                                "kind": "owner",
                                "field": "owner_user_id",
                                "user_id": "iam-subject",
                                "tenant_id": "tenant-1",
                            }
                        ],
                    }
                },
            )

    monkeypatch.setattr(
        gateway_authz,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=True, default_role="user"),
    )
    monkeypatch.setattr(gateway_authz, "_get_cached_route_provider", lambda _config: _Provider())
    request = SimpleNamespace(
        state=SimpleNamespace(
            iam_authz_attributes={
                "iam_credentials": {
                    "iam_access_token": "test-access-token",
                    "iam_subject": "iam-subject",
                    "iam_tenant_id": "tenant-1",
                }
            }
        ),
        headers={},
        _deerflow_test_bypass_auth=False,
    )
    user = SimpleNamespace(
        id="local-user-id",
        oauth_provider="central-iam",
        oauth_id="iam-subject",
        system_role="user",
    )

    await gateway_authz.require_iam_data_scope_for_request(request, user, target="projects:read")


@pytest.mark.asyncio
@pytest.mark.parametrize(("action", "target"), [("write", "agents:write"), ("delete", "agents:delete")])
async def test_agent_data_scope_passes_the_mutation_action_to_central_iam(monkeypatch, action, target):
    class _Provider:
        name = "central-iam"
        requires_iam_identity = True

        def __init__(self):
            self.request = None

        async def aresolve_data_scope(self, principal, **kwargs):
            self.request = kwargs
            return SimpleNamespace(
                allow=True,
                metadata={
                    "data_scope": {
                        "mode": "any_of",
                        "constraints": [
                            {
                                "kind": "owner",
                                "field": "owner_user_id",
                                "user_id": "iam-subject",
                                "tenant_id": "tenant-1",
                            }
                        ],
                    }
                },
            )

    provider = _Provider()
    monkeypatch.setattr(
        gateway_authz,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=True, default_role="user"),
    )
    monkeypatch.setattr(gateway_authz, "_get_cached_route_provider", lambda _config: provider)
    request = SimpleNamespace(
        state=SimpleNamespace(
            iam_authz_attributes={
                "iam_credentials": {
                    "iam_access_token": "test-access-token",
                    "iam_subject": "iam-subject",
                    "iam_tenant_id": "tenant-1",
                }
            }
        ),
        headers={},
        _deerflow_test_bypass_auth=False,
    )
    user = SimpleNamespace(
        id="local-user-id",
        oauth_provider="central-iam",
        oauth_id="iam-subject",
        system_role="user",
    )

    await gateway_authz.require_iam_data_scope_for_request(request, user, target=target, action=action)

    assert provider.request["resource"] == "route"
    assert provider.request["action"] == action
    assert provider.request["target"] == target


@pytest.mark.asyncio
async def test_project_data_scope_rejects_unmapped_tenant_wide_rows(monkeypatch):
    class _Provider:
        name = "central-iam"
        requires_iam_identity = True

        async def aresolve_data_scope(self, principal, **kwargs):
            return SimpleNamespace(
                allow=True,
                metadata={
                    "data_scope": {
                        "mode": "any_of",
                        "constraints": [{"kind": "tenant", "tenant_id": "tenant-1"}],
                    }
                },
            )

    monkeypatch.setattr(
        gateway_authz,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=True, default_role="user"),
    )
    monkeypatch.setattr(gateway_authz, "_get_cached_route_provider", lambda _config: _Provider())
    request = SimpleNamespace(
        state=SimpleNamespace(
            iam_authz_attributes={
                "iam_credentials": {
                    "iam_access_token": "test-access-token",
                    "iam_subject": "iam-subject",
                    "iam_tenant_id": "tenant-1",
                }
            }
        ),
        headers={},
        _deerflow_test_bypass_auth=False,
    )
    user = SimpleNamespace(
        id="local-user-id",
        oauth_provider="central-iam",
        oauth_id="iam-subject",
        system_role="user",
    )

    with pytest.raises(HTTPException) as error:
        await gateway_authz.require_iam_data_scope_for_request(request, user, target="projects:read")
    assert error.value.status_code == 503
