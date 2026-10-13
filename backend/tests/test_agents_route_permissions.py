"""Agent management routes enforce distinct IAM permissions before storage access."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from _router_auth_helpers import make_authed_test_app
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

from app.gateway.authz import AuthContext
from app.gateway.routers import agents, assistants_compat

_AGENT_PERMISSIONS = ("agents:read", "agents:write", "agents:delete", "agents:admin")


def _request(permissions: list[str]) -> Request:
    request = Request({"type": "http", "method": "GET", "path": "/api/agents", "headers": []})
    request.state.auth = AuthContext(user=SimpleNamespace(id="user-1"), permissions=permissions)
    return request


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("handler", "expected_permission"),
    [
        (lambda request: agents.list_agents(http_request=request), "agents:read"),
        (lambda request: agents.check_agent_name("demo", http_request=request), "agents:read"),
        (lambda request: agents.get_agent("demo", http_request=request), "agents:read"),
        (lambda request: agents.create_agent_endpoint(agents.AgentCreateRequest(name="demo"), http_request=request), "agents:write"),
        (lambda request: agents.update_agent("demo", agents.AgentUpdateRequest(description="new"), http_request=request), "agents:write"),
        (lambda request: agents.delete_agent("demo", http_request=request), "agents:delete"),
        (lambda request: agents.get_user_profile(http_request=request), "agents:admin"),
        (lambda request: agents.update_user_profile(agents.UserProfileUpdateRequest(content="new"), http_request=request), "agents:admin"),
    ],
)
async def test_agent_routes_reject_missing_specific_permission_before_storage(monkeypatch, handler, expected_permission):
    monkeypatch.setattr(agents, "_require_agents_api_enabled", lambda: pytest.fail("storage path reached before IAM permission check"))
    permissions = [value for value in _AGENT_PERMISSIONS if value != expected_permission]

    with pytest.raises(HTTPException) as denied:
        await handler(_request(permissions))

    assert denied.value.status_code == 403
    assert denied.value.detail == f"Permission denied: {expected_permission}"


_ASSISTANT_COMPAT_READ_HANDLERS = (
    lambda request: assistants_compat.search_assistants(request=request, body=None),
    lambda request: assistants_compat.get_assistant_compat("lead_agent", request=request),
    lambda request: assistants_compat.get_assistant_graph("lead_agent", request=request),
    lambda request: assistants_compat.get_assistant_schemas("lead_agent", request=request),
)


@pytest.mark.asyncio
@pytest.mark.parametrize("handler", _ASSISTANT_COMPAT_READ_HANDLERS)
async def test_assistant_compat_routes_require_agents_read_before_scope(monkeypatch, handler):
    scope_check = AsyncMock(side_effect=AssertionError("data-scope lookup must not run without agents:read"))
    monkeypatch.setattr(assistants_compat, "_require_assistant_read_scope", scope_check)
    monkeypatch.setattr(assistants_compat, "_list_assistants", lambda: pytest.fail("Agent storage reached before permission check"))

    with pytest.raises(HTTPException) as denied:
        await handler(_request([]))

    assert denied.value.status_code == 403
    assert denied.value.detail == "Permission denied: agents:read"
    scope_check.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("handler", _ASSISTANT_COMPAT_READ_HANDLERS)
async def test_assistant_compat_routes_check_scope_before_agent_storage(monkeypatch, handler):
    async def deny_scope(request, user, *, target, action="read", resource_id=None):
        assert target == "agents:read"
        raise HTTPException(status_code=403, detail="scope denied")

    monkeypatch.setattr(assistants_compat, "require_iam_data_scope_for_request", deny_scope)
    monkeypatch.setattr(assistants_compat, "_list_assistants", lambda: pytest.fail("Agent storage reached before data-scope check"))

    with pytest.raises(HTTPException) as denied:
        await handler(_request(["agents:read"]))

    assert denied.value.status_code == 403
    assert denied.value.detail == "scope denied"


def test_assistant_compat_search_binds_request_and_json_body(monkeypatch):
    app = make_authed_test_app()
    app.include_router(assistants_compat.router)
    monkeypatch.setattr(assistants_compat, "_require_assistant_read_scope", AsyncMock(return_value=None))
    monkeypatch.setattr(
        assistants_compat,
        "_list_assistants",
        lambda: [assistants_compat.AssistantResponse(assistant_id="custom", graph_id="lead_agent", name="custom")],
    )

    with TestClient(app) as client:
        response = client.post("/api/assistants/search", json={"name": "custom"})

    assert response.status_code == 200
    assert [assistant["assistant_id"] for assistant in response.json()] == ["custom"]
