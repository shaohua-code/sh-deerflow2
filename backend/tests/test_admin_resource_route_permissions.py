"""Central IAM guards protect shared configuration and user-owned skills."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request

from app.gateway.authz import AuthContext
from app.gateway.routers import channels, mcp, skills, subagents


def _request(permissions: list[str]) -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    request.state.auth = AuthContext(user=SimpleNamespace(id="user-1"), permissions=permissions)
    return request


_ADMIN_ROUTE_CASES = (
    ("channels:read", lambda request: channels.get_channels_status(request=request)),
    ("channels:admin", lambda request: channels.restart_channel("telegram", request=request)),
    ("mcp:admin", lambda request: mcp.get_mcp_configuration(request=request)),
    ("mcp:admin", lambda request: mcp.reset_mcp_tools_cache_endpoint(request=request)),
    ("mcp:admin", lambda request: mcp.update_mcp_configuration(request=request, body=None)),
    ("mcp:admin", lambda request: mcp.create_mcp_servers(request=request, body=None)),
    ("mcp:admin", lambda request: mcp.update_mcp_server(request=request, body=None)),
    ("mcp:admin", lambda request: mcp.delete_mcp_server(request=request, server_name="example")),
    ("mcp:admin", lambda request: mcp.update_mcp_server_state(request=request, body=None)),
    ("subagents:read", lambda request: subagents.list_subagents(request=request)),
    ("subagents:admin", lambda request: subagents.create_managed_subagent(request=request, body=None)),
    ("subagents:admin", lambda request: subagents.update_managed_subagent("example", request=request, body=None)),
    ("subagents:admin", lambda request: subagents.delete_managed_subagent("example", request=request)),
)


_SKILL_ROUTE_CASES = (
    ("skills:read", lambda request: skills.list_skills(request=request)),
    ("skills:read", lambda request: skills.list_custom_skills(request=request)),
    ("skills:read", lambda request: skills.get_skill("example", request=request)),
    ("skills:read", lambda request: skills.get_custom_skill("example", request=request)),
    ("skills:read", lambda request: skills.get_custom_skill_history("example", request=request)),
    ("skills:read", lambda request: skills.preview_custom_skill_export("example", request=request, response=None)),
    ("skills:read", lambda request: skills.download_custom_skill_export("example", request=request)),
    ("skills:write", lambda request: skills.install_skill(request=request, body=None)),
    ("skills:write", lambda request: skills.upload_and_install_skill(request=request)),
    (("skills:write", "skills:read"), lambda request: skills.update_custom_skill("example", body=None, request=request)),
    (("skills:write", "skills:read"), lambda request: skills.rollback_custom_skill("example", body=None, request=request)),
    ("skills:delete", lambda request: skills.delete_custom_skill("example", request=request)),
    ("skills:admin", lambda request: skills.reload_skills(request=request)),
    ("skills:admin", lambda request: skills.update_skill("example", body=None, request=request)),
)


@pytest.mark.asyncio
@pytest.mark.parametrize(("required", "handler"), _ADMIN_ROUTE_CASES + _SKILL_ROUTE_CASES)
async def test_routes_reject_missing_central_permission_before_handler(required, handler):
    required_permissions = (required,) if isinstance(required, str) else required
    for missing in required_permissions:
        granted = [permission for permission in required_permissions if permission != missing]
        with pytest.raises(HTTPException) as denied:
            await handler(_request(granted))
        assert denied.value.status_code == 403
        assert denied.value.detail == f"Permission denied: {missing}"


_SKILL_SCOPE_CASES = (
    ("skills:read", "read", lambda request: skills.list_custom_skills(request=request)),
    ("skills:read", "read", lambda request: skills.update_custom_skill("example", body=None, request=request)),
    ("skills:write", "write", lambda request: skills.update_custom_skill("example", body=None, request=request)),
    ("skills:read", "read", lambda request: skills.rollback_custom_skill("example", body=None, request=request)),
    ("skills:write", "write", lambda request: skills.rollback_custom_skill("example", body=None, request=request)),
    ("skills:delete", "delete", lambda request: skills.delete_custom_skill("example", request=request)),
)


@pytest.mark.asyncio
@pytest.mark.parametrize(("target", "action", "handler"), _SKILL_SCOPE_CASES)
async def test_user_skill_scope_is_checked_before_storage(target, action, handler, monkeypatch):
    async def deny_scope(request, user, *, target: str, action: str, resource_id=None):
        if target == deny_scope.target and action == deny_scope.action:
            raise HTTPException(status_code=403, detail="scope denied")

    deny_scope.target = target
    deny_scope.action = action
    monkeypatch.setattr(skills, "require_iam_data_scope_for_request", deny_scope)
    monkeypatch.setattr(
        skills,
        "_get_user_skill_storage",
        lambda *args, **kwargs: pytest.fail("user skill storage reached before data-scope authorization"),
    )

    with pytest.raises(HTTPException) as denied:
        await handler(_request(["skills:read", "skills:write", "skills:delete"]))

    assert denied.value.status_code == 403
    assert denied.value.detail == "scope denied"
