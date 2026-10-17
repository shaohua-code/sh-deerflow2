"""Mid-stream permission rechecks terminate revoked SSE consumers.

``@require_permission`` runs once at connection setup, but an SSE stream
outlives that grant: a permission revoked (or an account deactivated) while a
run is in flight used to keep streaming until the run finished. These tests
pin the heartbeat-driven recheck contract added for that gap:

- a denied recheck ends the revoked caller's stream with ``end`` and never
  cancels the run itself — not even through the creating endpoint's
  cancel-on-disconnect policy, which must stay reserved for the creator
  actually disconnecting;
- rechecks only run when route authorization is enabled, and transient
  recheck failures fail open, so only explicit denials tear a stream down;
- cookie callers are re-resolved from the repository (role change and
  deactivation observed mid-stream); non-cookie callers keep their
  connection-setup identity while their grants are still re-evaluated.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import app.gateway.authz as authz_module
import app.gateway.services as services_module
from app.gateway.authz import recheck_stream_permission
from app.gateway.services import sse_consumer
from deerflow.runtime import MemoryStreamBridge, RunManager, RunStatus

THREAD_ID = "thread-perm-recheck"


def _make_request(*, cookies: dict | None = None, state_user=None) -> SimpleNamespace:
    """A request stub with the surface sse_consumer/recheck actually touch."""
    return SimpleNamespace(
        headers={},
        cookies=cookies or {},
        state=SimpleNamespace(user=state_user),
        is_disconnected=AsyncMock(return_value=False),
    )


async def _seed_running_record() -> tuple[RunManager, object]:
    mgr = RunManager()
    record = await mgr.create(THREAD_ID)
    # 保持与既有流式路由测试一致的种子方式；run_id 用 record 实际值。
    await mgr.set_status(record.run_id, RunStatus.running)
    return mgr, record


async def _collect_frames(**consumer_kwargs) -> list[str]:
    bridge = MemoryStreamBridge(heartbeat_interval=0.01)
    mgr, record = await _seed_running_record()
    request = _make_request()
    frames: list[str] = []

    async def _drive():
        async for frame in sse_consumer(bridge, record, request, mgr, **consumer_kwargs):
            frames.append(frame)

    driver = asyncio.create_task(_drive())
    # 给订阅一点时间就位，再发布事件驱动循环；终止断言交给显式 end。
    await asyncio.sleep(0.05)
    await bridge.publish(record.run_id, "message", {"content": "hello"})
    await asyncio.sleep(0.15)
    await bridge.publish_end(record.run_id)
    await asyncio.wait_for(driver, timeout=5.0)
    return frames


# --- recheck_stream_permission unit behavior ---


def test_recheck_skipped_when_authorization_disabled(monkeypatch: pytest.MonkeyPatch):
    """Legacy all-permissions mode has nothing to re-evaluate."""
    monkeypatch.setattr(
        authz_module,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=False),
    )
    request = _make_request()

    assert asyncio.run(recheck_stream_permission(request, "runs", "read")) is True


def test_recheck_denies_when_permission_missing(monkeypatch: pytest.MonkeyPatch):
    """A revoked grant is an explicit deny even for non-cookie callers."""
    monkeypatch.setattr(
        authz_module,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=True),
    )
    monkeypatch.setattr(
        authz_module,
        "resolve_route_permissions_for_request",
        AsyncMock(return_value=["runs:read"]),
    )
    state_user = SimpleNamespace(id="user-1", is_active=True)
    request = _make_request(state_user=state_user)

    assert asyncio.run(recheck_stream_permission(request, "runs", "create")) is False
    assert asyncio.run(recheck_stream_permission(request, "runs", "read")) is True


def test_recheck_reresolves_cookie_user_from_repository(monkeypatch: pytest.MonkeyPatch):
    """Cookie callers bypass the request-state cache and re-read the account."""
    monkeypatch.setattr(
        authz_module,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=True),
    )
    seen_users: list[object] = []

    async def _fake_resolve(request, user):
        seen_users.append(user)
        return ["runs:read"]

    monkeypatch.setattr(authz_module, "resolve_route_permissions_for_request", _fake_resolve)

    class _Provider:
        def __init__(self, user):
            self._user = user

        async def get_user(self, user_id):
            return self._user

    active_user = SimpleNamespace(id="user-1", is_active=True)
    monkeypatch.setattr("app.gateway.auth.decode_token", lambda token: SimpleNamespace(sub=str(active_user.id)))
    monkeypatch.setattr("app.gateway.deps.get_local_provider", lambda: _Provider(active_user))

    stale_state_user = SimpleNamespace(id="user-1", is_active=True, system_role="user")
    request = _make_request(cookies={"access_token": "token"}, state_user=stale_state_user)

    assert asyncio.run(recheck_stream_permission(request, "runs", "read")) is True
    # 复查必须用仓储重载的账号（可能已换角色），而不是 state 上的静态快照。
    assert seen_users and seen_users[0] is active_user


def test_recheck_denies_deactivated_cookie_user(monkeypatch: pytest.MonkeyPatch):
    """A deactivated account loses the stream even with grants intact."""
    monkeypatch.setattr(
        authz_module,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=True),
    )

    class _Provider:
        async def get_user(self, user_id):
            return SimpleNamespace(id="user-1", is_active=False)

    monkeypatch.setattr("app.gateway.auth.decode_token", lambda token: SimpleNamespace(sub="user-1"))
    monkeypatch.setattr("app.gateway.deps.get_local_provider", lambda: _Provider())
    request = _make_request(cookies={"access_token": "token"})

    assert asyncio.run(recheck_stream_permission(request, "runs", "read")) is False


def test_recheck_denies_invalid_session_token(monkeypatch: pytest.MonkeyPatch):
    """An expired/revoked session cookie would fail a fresh request too."""
    from app.gateway.auth.errors import TokenError

    monkeypatch.setattr(
        authz_module,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=True),
    )
    monkeypatch.setattr("app.gateway.auth.decode_token", lambda token: TokenError.EXPIRED)
    request = _make_request(cookies={"access_token": "token"})

    assert asyncio.run(recheck_stream_permission(request, "runs", "read")) is False


def test_recheck_fails_open_on_transient_error(monkeypatch: pytest.MonkeyPatch):
    """Infrastructure failures must not tear down healthy streams."""
    monkeypatch.setattr(
        authz_module,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=True),
    )

    async def _boom(request, user):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(authz_module, "resolve_route_permissions_for_request", _boom)
    state_user = SimpleNamespace(id="user-1", is_active=True)
    request = _make_request(state_user=state_user)

    assert asyncio.run(recheck_stream_permission(request, "runs", "read")) is True


# --- data-scope recheck dimension ---


def test_data_scope_denial_ends_stream(monkeypatch: pytest.MonkeyPatch):
    """A mid-run Central IAM row-scope revocation is an explicit deny."""
    from fastapi import HTTPException

    monkeypatch.setattr(
        authz_module,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=True),
    )
    monkeypatch.setattr(
        authz_module,
        "resolve_route_permissions_for_request",
        AsyncMock(return_value=["runs:read"]),
    )
    scope_check = AsyncMock(side_effect=HTTPException(status_code=403, detail="denied"))
    monkeypatch.setattr(authz_module, "require_iam_data_scope_for_request", scope_check)
    state_user = SimpleNamespace(id="user-1", is_active=True)
    request = _make_request(state_user=state_user)

    assert (
        asyncio.run(
            recheck_stream_permission(
                request,
                "runs",
                "read",
                data_scope_target="runs:read",
                data_scope_action="read",
            )
        )
        is False
    )
    # 复查必须沿用刚重载的账号，而不是连接建立时的 state 快照。
    scope_check.assert_awaited_once()
    assert scope_check.await_args.kwargs["target"] == "runs:read"
    assert scope_check.await_args.kwargs["action"] == "read"


def test_data_scope_unavailable_fails_open(monkeypatch: pytest.MonkeyPatch):
    """Transient IAM scope-check failures keep the stream open."""
    from fastapi import HTTPException

    monkeypatch.setattr(
        authz_module,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=True),
    )
    monkeypatch.setattr(
        authz_module,
        "resolve_route_permissions_for_request",
        AsyncMock(return_value=["runs:read"]),
    )
    scope_check = AsyncMock(side_effect=HTTPException(status_code=503, detail="IAM unavailable"))
    monkeypatch.setattr(authz_module, "require_iam_data_scope_for_request", scope_check)
    state_user = SimpleNamespace(id="user-1", is_active=True)
    request = _make_request(state_user=state_user)

    assert (
        asyncio.run(
            recheck_stream_permission(
                request,
                "runs",
                "read",
                data_scope_target="runs:read",
                data_scope_action="read",
            )
        )
        is True
    )


def test_data_scope_untouched_when_not_opted_in(monkeypatch: pytest.MonkeyPatch):
    """Without data_scope_target the scope check never runs (P359 compat)."""
    monkeypatch.setattr(
        authz_module,
        "_get_route_authorization_config",
        lambda: SimpleNamespace(enabled=True),
    )
    monkeypatch.setattr(
        authz_module,
        "resolve_route_permissions_for_request",
        AsyncMock(return_value=["runs:read"]),
    )
    scope_check = AsyncMock()
    monkeypatch.setattr(authz_module, "require_iam_data_scope_for_request", scope_check)
    state_user = SimpleNamespace(id="user-1", is_active=True)
    request = _make_request(state_user=state_user)

    assert asyncio.run(recheck_stream_permission(request, "runs", "read")) is True
    scope_check.assert_not_awaited()


def test_data_scope_pass_through_reaches_stream_consumer(monkeypatch: pytest.MonkeyPatch):
    """sse_consumer forwards data_scope_recheck into the recheck kwargs."""
    captured: dict[str, object] = {}

    async def _allow(request, resource, action, *, data_scope_target=None, data_scope_action=None):
        captured["target"] = data_scope_target
        captured["action"] = data_scope_action
        return True

    monkeypatch.setattr(services_module, "recheck_stream_permission", _allow)

    frames = asyncio.run(
        _collect_frames(
            permission_recheck=("runs", "read"),
            permission_recheck_interval=0.0,
            data_scope_recheck=("runs:read", "read"),
        )
    )

    assert frames[-1].startswith("event: end")
    assert captured == {"target": "runs:read", "action": "read"}


# --- sse_consumer mid-stream termination behavior ---


@pytest.mark.anyio
async def test_denied_recheck_ends_stream_without_cancelling_run(monkeypatch: pytest.MonkeyPatch):
    """Revocation ends the caller's stream; the run itself keeps running."""
    event_published = asyncio.Event()
    recheck_calls: list[tuple[str, str]] = []

    async def _fake_recheck(request, resource, action, **_kwargs):
        recheck_calls.append((resource, action))
        # 事件发布前的复查一律允许；之后的心跳模拟管理员撤权，
        # 保证事件帧先于终止帧，断言无时序竞态。
        return not event_published.is_set()

    monkeypatch.setattr(services_module, "recheck_stream_permission", _fake_recheck)

    bridge = MemoryStreamBridge(heartbeat_interval=0.01)
    mgr, record = await _seed_running_record()
    request = _make_request()
    frames: list[str] = []

    async def _drive():
        async for frame in sse_consumer(
            bridge,
            record,
            request,
            mgr,
            permission_recheck=("runs", "read"),
            permission_recheck_interval=0.0,
        ):
            frames.append(frame)

    driver = asyncio.create_task(_drive())
    await asyncio.sleep(0.05)
    await bridge.publish(record.run_id, "message", {"content": "hello"})
    event_published.set()
    await asyncio.wait_for(driver, timeout=5.0)

    # 事件帧之后以 end 终止（与正常完成同帧型，数据已停止外推）。
    assert frames[-1].startswith("event: end")
    assert any(frame.startswith("event: message") for frame in frames)
    assert ("runs", "read") in recheck_calls

    refreshed = await mgr.get(record.run_id)
    assert refreshed is not None
    # 撤权终止的是该调用方的视图，绝不触发 cancel-on-disconnect 取消 run。
    assert refreshed.status == RunStatus.running


@pytest.mark.anyio
async def test_allowed_rechecks_keep_stream_until_end(monkeypatch: pytest.MonkeyPatch):
    """Passing rechecks leave the normal end-of-run path untouched."""

    async def _allow(request, resource, action, **_kwargs):
        return True

    monkeypatch.setattr(services_module, "recheck_stream_permission", _allow)

    frames = await _collect_frames(
        permission_recheck=("runs", "read"),
        permission_recheck_interval=0.0,
    )

    assert frames[-1].startswith("event: end")
    assert any(frame.startswith("event: message") for frame in frames)


@pytest.mark.anyio
async def test_recheck_opt_out_keeps_legacy_behavior(monkeypatch: pytest.MonkeyPatch):
    """Callers that do not opt in never invoke the recheck (default compat)."""

    async def _unexpected(request, resource, action):
        raise AssertionError("recheck must not run without permission_recheck")

    monkeypatch.setattr(services_module, "recheck_stream_permission", _unexpected)

    frames = await _collect_frames()

    assert frames[-1].startswith("event: end")
