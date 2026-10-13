from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.gateway import one_shot_model
from deerflow.authz.iam_model_usage import IamModelQuotaExceeded
from deerflow.authz.iam_model_usage_callback import get_run_iam_model_usage_callback
from deerflow.authz.provider import AuthzDecision, AuthzRequest


def _request(*, attributes: dict | None = None) -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/api/input-polish", "headers": []})
    request.state.auth = SimpleNamespace(user=SimpleNamespace(id="local-user"))
    request.state.iam_authz_attributes = attributes or {}
    return request


def _config():
    return SimpleNamespace(
        authorization=SimpleNamespace(fail_closed=True),
        models=[SimpleNamespace(name="trusted-profile")],
        get_model_config=lambda name: {"name": name} if name == "trusted-profile" else None,
    )


def test_one_shot_call_checks_the_resolved_model_before_provider_dispatch(monkeypatch):
    request = _request(attributes={"iam_credentials": {"iam_subject": "subject-1"}})
    provider = SimpleNamespace(aauthorize=AsyncMock(return_value=AuthzDecision(allow=False)))
    principal = object()
    resolve = MagicMock(return_value=(provider, principal))
    usage_builder = MagicMock()
    provider_call = AsyncMock(return_value="must-not-run")
    monkeypatch.setattr(one_shot_model, "resolve_model_authorization", resolve)
    monkeypatch.setattr(one_shot_model, "_is_internal_caller", lambda *_: False)
    monkeypatch.setattr(one_shot_model, "build_iam_model_usage_callback", usage_builder)
    monkeypatch.setattr(one_shot_model, "run_oneshot_llm", provider_call)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(
            one_shot_model.run_authorized_one_shot_model(
                request=request,
                system_instruction="system",
                user_content="private draft",
                run_name="input_polish",
                app_config=_config(),
            ),
        )

    assert denied.value.status_code == 403
    checked = provider.aauthorize.await_args.args[0]
    assert isinstance(checked, AuthzRequest)
    assert (checked.resource, checked.action, checked.target) == ("model", "use", "trusted-profile")
    assert checked.principal is principal
    provider_call.assert_not_awaited()
    usage_builder.assert_not_called()


def test_one_shot_call_binds_and_closes_iam_usage_callback(monkeypatch):
    attributes = {"iam_credentials": {"iam_subject": "subject-1"}, "iam_tenant_id": "tenant"}
    request = _request(attributes=attributes)
    provider = SimpleNamespace(aauthorize=AsyncMock(return_value=AuthzDecision(allow=True)))
    principal = object()
    callback = SimpleNamespace(close=MagicMock())
    monkeypatch.setattr(one_shot_model, "resolve_model_authorization", lambda *_args, **_kwargs: (provider, principal))
    monkeypatch.setattr(one_shot_model, "_is_internal_caller", lambda *_: False)
    usage_builder = MagicMock(return_value=callback)
    monkeypatch.setattr(one_shot_model, "build_iam_model_usage_callback", usage_builder)

    async def _provider_call(**_kwargs):
        assert get_run_iam_model_usage_callback() is callback
        return "rewritten"

    runner = AsyncMock(side_effect=_provider_call)
    monkeypatch.setattr(one_shot_model, "run_oneshot_llm", runner)
    config = _config()

    result = asyncio.run(
        one_shot_model.run_authorized_one_shot_model(
            request=request,
            system_instruction="system",
            user_content="private draft",
            run_name="input_polish",
            app_config=config,
        ),
    )

    assert result == "rewritten"
    usage_builder.assert_called_once_with(config, attributes)
    assert runner.await_args.kwargs["model_name"] == "trusted-profile"
    callback.close.assert_called_once()
    assert get_run_iam_model_usage_callback() is None


def test_one_shot_quota_denial_is_returned_as_http_429_and_closes_callback(monkeypatch):
    request = _request(attributes={"iam_credentials": {"iam_subject": "subject-1"}})
    provider = SimpleNamespace(aauthorize=AsyncMock(return_value=AuthzDecision(allow=True)))
    callback = SimpleNamespace(close=MagicMock())
    monkeypatch.setattr(one_shot_model, "resolve_model_authorization", lambda *_args, **_kwargs: (provider, object()))
    monkeypatch.setattr(one_shot_model, "_is_internal_caller", lambda *_: False)
    monkeypatch.setattr(one_shot_model, "build_iam_model_usage_callback", lambda *_args: callback)
    monkeypatch.setattr(
        one_shot_model,
        "run_oneshot_llm",
        AsyncMock(side_effect=IamModelQuotaExceeded(429, "quota denied")),
    )

    with pytest.raises(HTTPException) as denied:
        asyncio.run(
            one_shot_model.run_authorized_one_shot_model(
                request=request,
                system_instruction="system",
                user_content="private draft",
                run_name="input_polish",
                app_config=_config(),
            ),
        )

    assert denied.value.status_code == 429
    callback.close.assert_called_once()
