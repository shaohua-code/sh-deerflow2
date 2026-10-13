"""Central IAM permissions and self scopes protect user-owned connector routes."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Request

from app.gateway.authz import AuthContext
from app.gateway.routers import channel_connections, integrations

_ROUTE_CASES = (
    (("channels:read",), lambda request: channel_connections.get_channel_providers(request=request)),
    (("channels:read",), lambda request: channel_connections.get_channel_connections(request=request)),
    (("channels:write",), lambda request: channel_connections.disconnect_channel_connection("connection-1", request=request)),
    (("channels:admin",), lambda request: channel_connections.disconnect_channel_provider_runtime("telegram", request=request)),
    (("channels:write",), lambda request: channel_connections.connect_channel_provider("telegram", request=request)),
    (("channels:admin",), lambda request: channel_connections.configure_channel_provider_runtime("telegram", channel_connections.ChannelRuntimeConfigRequest(), request=request)),
    (("integrations:read",), lambda request: integrations.get_lark_status(request=request)),
    (("integrations:admin", "integrations:write", "integrations:read"), lambda request: integrations.install_lark(request=request)),
    (("integrations:write",), lambda request: integrations.start_lark_app_config(request=request, body=None)),
    (("integrations:write", "integrations:read"), lambda request: integrations.complete_lark_app_config(request=request, body=None)),
    (("integrations:write", "integrations:read"), lambda request: integrations.switch_lark_app_credentials(request=request, body=None)),
    (("integrations:write",), lambda request: integrations.start_lark_browser_auth(request=request, body=None)),
    (("integrations:write", "integrations:read"), lambda request: integrations.complete_lark_browser_auth(request=request, body=None)),
)


def _request(permissions: list[str]) -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    request.state.auth = AuthContext(user=SimpleNamespace(id="user-1"), permissions=permissions)
    return request


@pytest.mark.asyncio
@pytest.mark.parametrize(("required", "handler"), _ROUTE_CASES)
async def test_connector_routes_reject_missing_permissions_before_handlers(monkeypatch, required, handler):
    for missing in required:
        granted = [permission for permission in required if permission != missing]
        with pytest.raises(HTTPException) as denied:
            await handler(_request(granted))
        assert denied.value.status_code == 403
        assert denied.value.detail == f"Permission denied: {missing}"


_SCOPE_CASES = (
    ("channels:read", "read", lambda request: channel_connections.get_channel_providers(request=request)),
    ("channels:read", "read", lambda request: channel_connections.get_channel_connections(request=request)),
    ("channels:write", "write", lambda request: channel_connections.disconnect_channel_connection("connection-1", request=request)),
    ("channels:write", "write", lambda request: channel_connections.connect_channel_provider("telegram", request=request)),
    ("integrations:read", "read", lambda request: integrations.get_lark_status(request=request)),
    ("integrations:read", "read", lambda request: integrations.install_lark(request=request)),
    ("integrations:write", "write", lambda request: integrations.install_lark(request=request)),
    ("integrations:write", "write", lambda request: integrations.start_lark_app_config(request=request, body=None)),
    ("integrations:read", "read", lambda request: integrations.complete_lark_app_config(request=request, body=None)),
    ("integrations:write", "write", lambda request: integrations.complete_lark_app_config(request=request, body=None)),
    ("integrations:read", "read", lambda request: integrations.switch_lark_app_credentials(request=request, body=None)),
    ("integrations:write", "write", lambda request: integrations.switch_lark_app_credentials(request=request, body=None)),
    ("integrations:write", "write", lambda request: integrations.start_lark_browser_auth(request=request, body=None)),
    ("integrations:read", "read", lambda request: integrations.complete_lark_browser_auth(request=request, body=None)),
    ("integrations:write", "write", lambda request: integrations.complete_lark_browser_auth(request=request, body=None)),
)


@pytest.mark.asyncio
@pytest.mark.parametrize(("target", "action", "handler"), _SCOPE_CASES)
async def test_personal_connector_routes_check_scope_before_service_access(monkeypatch, target, action, handler):
    async def deny_scope(request, user, *, target: str, action: str = "read", resource_id=None):
        if target == deny_scope.target:
            assert action == deny_scope.action
            raise HTTPException(status_code=403, detail="scope denied")

    deny_scope.target = target
    deny_scope.action = action
    monkeypatch.setattr(channel_connections, "require_iam_data_scope_for_request", deny_scope)
    monkeypatch.setattr(integrations, "require_iam_data_scope_for_request", deny_scope)
    monkeypatch.setattr(integrations, "require_admin_user", AsyncMock(return_value=None))
    permissions = ["channels:read", "channels:write", "channels:admin", "integrations:read", "integrations:write", "integrations:admin"]

    with pytest.raises(HTTPException) as denied:
        await handler(_request(permissions))

    assert denied.value.status_code == 403
    assert denied.value.detail == "scope denied"
