"""Offline contract tests for per-call Central IAM usage callbacks."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from langchain_core.callbacks.manager import AsyncCallbackManager

from deerflow.authz.iam_model_usage import IamModelQuotaExceeded
from deerflow.authz.iam_model_usage_callback import (
    IamModelUsageCallback,
    build_iam_model_usage_callback,
)

_TENANT_ID = str(uuid4())
_APPLICATION_ID = str(uuid4())
_MODEL_ID = str(uuid4())
_USER_ID = str(uuid4())


class _FakeUsageClient:
    def __init__(self, *, reservation_required: bool = True, deny: bool = False) -> None:
        self.reservation_required = reservation_required
        self.deny = deny
        self.calls: list[tuple[str, dict]] = []

    def resolve_user_id(self, access_token: str) -> str:
        self.calls.append(("resolve", {"access_token": access_token}))
        return _USER_ID

    def reserve_usage(self, **kwargs):  # noqa: ANN003
        self.calls.append(("reserve", kwargs))
        if self.deny:
            raise IamModelQuotaExceeded(429, "IAM model quota exceeded")
        return {"allowed": True, "reservation_required": self.reservation_required}

    def settle_usage(self, **kwargs):  # noqa: ANN003
        self.calls.append(("settle", kwargs))
        return {"settled": True}

    def report_usage(self, **kwargs):  # noqa: ANN003
        self.calls.append(("report", kwargs))
        return {"recorded": True}


class _FakeOutbox:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def enqueue(self, **payload):
        self.calls.append(("enqueue", payload))

    def dispatch_request(self, request_id, _client):
        self.calls.append(("dispatch", {"request_id": request_id}))


def _callback(client: _FakeUsageClient, *, model_name: str = "gpt-4o") -> IamModelUsageCallback:
    return IamModelUsageCallback(
        client=client,  # type: ignore[arg-type]
        credentials={"iam_access_token": "server-vault-token"},
        tenant_id=_TENANT_ID,
        application_id=_APPLICATION_ID,
        model_resource_ids={model_name: _MODEL_ID},
        reserved_output_tokens={model_name: 512},
    )


def test_callback_reserves_before_completion_and_sends_only_usage_metadata() -> None:
    client = _FakeUsageClient()
    callback = _callback(client)
    call_id = uuid4()

    callback.on_chat_model_start(
        {"kwargs": {"model": "gpt-4o"}},
        [[{"type": "human", "content": "private prompt text"}]],
        run_id=call_id,
    )

    assert [name for name, _ in client.calls] == ["resolve", "reserve"]
    reserve = client.calls[1][1]
    assert reserve["tenant_id"] == _TENANT_ID
    assert reserve["model_id"] == _MODEL_ID
    assert reserve["application_id"] == _APPLICATION_ID
    assert reserve["user_id"] == _USER_ID
    assert reserve["reserved_input_tokens"] > 0
    assert reserve["reserved_output_tokens"] == 512
    assert "private prompt text" not in repr(client.calls)
    assert "server-vault-token" not in repr(callback)

    callback.on_llm_end(
        SimpleNamespace(
            llm_output={"token_usage": {"prompt_tokens": 7, "completion_tokens": 4}},
            generations=[],
        ),
        run_id=call_id,
    )

    assert [name for name, _ in client.calls] == ["resolve", "reserve", "settle"]
    settlement = client.calls[-1][1]
    assert settlement["request_id"] == reserve["request_id"]
    assert settlement["input_tokens"] == 7
    assert settlement["output_tokens"] == 4
    assert settlement["usage_is_estimated"] is False


def test_callback_reports_without_reservation_when_iam_quota_is_disabled() -> None:
    client = _FakeUsageClient(reservation_required=False)
    callback = _callback(client)
    call_id = uuid4()

    callback.on_llm_start(
        {"kwargs": {"model_name": "gpt-4o"}},
        ["private prompt"],
        run_id=call_id,
    )
    callback.on_llm_end(
        SimpleNamespace(llm_output={"usage": {"input_tokens": 2, "output_tokens": 3}}, generations=[]),
        run_id=call_id,
    )

    assert [name for name, _ in client.calls] == ["resolve", "reserve", "report"]
    report = client.calls[-1][1]
    assert report["input_tokens"] == 2
    assert report["output_tokens"] == 3
    assert report["tenant_id"] == _TENANT_ID
    assert "private prompt" not in repr(report)


def test_model_bound_callback_uses_server_profile_alias_not_provider_deployment_name() -> None:
    client = _FakeUsageClient()
    callback = _callback(client, model_name="deerflow-default")
    model_callback = callback.for_model("deerflow-default")
    call_id = uuid4()

    model_callback.on_chat_model_start(
        {"kwargs": {"model": "provider-deployment-v3"}},
        [[{"type": "human", "content": "private prompt"}]],
        run_id=call_id,
    )
    model_callback.on_llm_end(
        SimpleNamespace(llm_output={"token_usage": {"prompt_tokens": 3, "completion_tokens": 2}}, generations=[]),
        run_id=call_id,
    )

    assert client.calls[1][0] == "reserve"
    assert client.calls[1][1]["model_id"] == _MODEL_ID
    assert client.calls[-1][0] == "settle"


def test_reservation_denial_propagates_before_provider_dispatch() -> None:
    callback = _callback(_FakeUsageClient(deny=True))

    with pytest.raises(IamModelQuotaExceeded, match="IAM model quota exceeded"):
        callback.on_chat_model_start(
            {"kwargs": {"model": "gpt-4o"}},
            [[{"type": "human", "content": "must not reach the provider"}]],
            run_id=uuid4(),
        )


@pytest.mark.asyncio
async def test_async_langchain_manager_propagates_reservation_denial_before_model_call() -> None:
    client = _FakeUsageClient(deny=True)
    callback = _callback(client, model_name="deerflow-default")
    manager = AsyncCallbackManager.configure(inheritable_callbacks=[callback.for_model("deerflow-default")])
    provider_calls = 0

    with pytest.raises(IamModelQuotaExceeded, match="IAM model quota exceeded"):
        await manager.on_chat_model_start(
            {"kwargs": {"model": "provider-deployment-v3"}},
            [[{"type": "human", "content": "never dispatched"}]],
            run_id=uuid4(),
        )
        provider_calls += 1

    assert provider_calls == 0
    assert client.calls[-1][0] == "reserve"
    assert client.calls[-1][1]["model_id"] == _MODEL_ID


def test_close_leaves_attempts_missing_a_terminal_callback_for_reconciliation() -> None:
    client = _FakeUsageClient()
    callback = _callback(client)
    callback.on_llm_start({"kwargs": {"model": "gpt-4o"}}, ["secret"], run_id=uuid4())

    callback.close()

    assert [name for name, _ in client.calls] == ["resolve", "reserve"]
    assert client.calls[-1][1]["request_id"].startswith("deerflow:llm:")


def test_builder_is_disabled_by_default_and_requires_explicit_output_caps() -> None:
    provider = SimpleNamespace(
        use="deerflow.authz.iam_deerflow:DeerFlowIamAuthorizationProvider",
        config={
            "api_base_url": "https://iam.example.test",
            "application_id": _APPLICATION_ID,
            "model_resource_ids": {"gpt-4o": _MODEL_ID},
            "model_usage": {"enabled": False},
        },
    )
    app_config = SimpleNamespace(authorization=SimpleNamespace(enabled=True, provider=provider))
    credentials = {"iam_access_token": "server-vault-token", "iam_tenant_id": _TENANT_ID}

    assert build_iam_model_usage_callback(app_config, credentials, environ={}) is None

    provider.config["model_usage"] = {"enabled": True}
    with pytest.raises(ValueError, match="reserved_output_tokens"):
        build_iam_model_usage_callback(
            app_config,
            credentials,
            environ={"IAM_MODEL_USAGE_API_KEY": "k" * 40},
        )


def test_terminal_usage_is_persisted_before_outbox_delivery() -> None:
    client = _FakeUsageClient()
    outbox = _FakeOutbox()
    callback = IamModelUsageCallback(
        client=client,  # type: ignore[arg-type]
        credentials={"iam_access_token": "server-vault-token"},
        tenant_id=_TENANT_ID,
        application_id=_APPLICATION_ID,
        model_resource_ids={"gpt-4o": _MODEL_ID},
        reserved_output_tokens={"gpt-4o": 512},
        outbox_store=outbox,  # type: ignore[arg-type]
    )
    call_id = uuid4()
    callback.on_llm_start({"kwargs": {"model": "gpt-4o"}}, ["private prompt"], run_id=call_id)
    callback.on_llm_end(
        SimpleNamespace(llm_output={"token_usage": {"prompt_tokens": 3, "completion_tokens": 2}}, generations=[]),
        run_id=call_id,
    )

    assert [name for name, _ in outbox.calls] == ["enqueue", "dispatch"]
    assert outbox.calls[0][1]["action"] == "settle"
    assert outbox.calls[0][1]["input_tokens"] == 3
    assert "private prompt" not in repr(outbox.calls)
    assert "server-vault-token" not in repr(outbox.calls)


def test_failed_model_call_remains_reserved_for_admin_reconciliation() -> None:
    client = _FakeUsageClient()
    callback = _callback(client)
    call_id = uuid4()

    callback.on_llm_start({"kwargs": {"model": "gpt-4o"}}, ["secret"], run_id=call_id)
    callback.on_llm_error(RuntimeError("provider details must not be copied"), run_id=call_id)
    callback.close()

    assert [name for name, _ in client.calls] == ["resolve", "reserve"]
    assert client.calls[-1][1]["request_id"].startswith("deerflow:llm:")
    assert "provider details" not in repr(client.calls)


def test_memory_model_usage_callback_is_ephemeral_and_closed(monkeypatch) -> None:
    from deerflow.agents.memory import manager as memory_manager
    from deerflow.agents.memory.manager import LangfuseMemoryCallbacks

    class _MemoryUsageCallback:
        def __init__(self) -> None:
            self.closed = False

        def close(self) -> None:
            self.closed = True

    usage_callback = _MemoryUsageCallback()
    monkeypatch.setattr(memory_manager, "_gateway_memory_model_authorizer", lambda **_kwargs: True)
    monkeypatch.setattr(
        memory_manager,
        "_gateway_memory_usage_callback_factory",
        lambda **_kwargs: usage_callback,
    )
    callbacks = LangfuseMemoryCallbacks(extensions=SimpleNamespace(has_system_model_observers=False))
    invoke_config: dict = {"run_name": "memory_agent"}

    callbacks.on_memory_llm_call(
        invoke_config,
        thread_id="thread-1",
        user_id="user-1",
        trace_id="trace-1",
        model_name="gpt-4o",
    )

    assert invoke_config["callbacks"] == [usage_callback]
    callbacks.on_memory_llm_result(
        invoke_config,
        prompt="private prompt",
        response=SimpleNamespace(content="private response"),
        error=None,
        duration_ms=1,
        model_name="gpt-4o",
    )

    assert usage_callback.closed is True
    assert "callbacks" not in invoke_config


def test_memory_model_usage_admission_failure_prevents_invoke_config(monkeypatch) -> None:
    from deerflow.agents.memory import manager as memory_manager
    from deerflow.agents.memory.manager import LangfuseMemoryCallbacks

    monkeypatch.setattr(memory_manager, "_gateway_memory_model_authorizer", lambda **_kwargs: True)

    def _deny_usage(**_kwargs):
        raise RuntimeError("sensitive provider detail")

    monkeypatch.setattr(memory_manager, "_gateway_memory_usage_callback_factory", _deny_usage)
    callbacks = LangfuseMemoryCallbacks(extensions=SimpleNamespace(has_system_model_observers=False))
    invoke_config: dict = {"run_name": "memory_agent"}

    with pytest.raises(RuntimeError, match="Central IAM model usage admission is unavailable"):
        callbacks.on_memory_llm_call(
            invoke_config,
            thread_id="thread-1",
            user_id="user-1",
            trace_id="trace-1",
            model_name="gpt-4o",
        )

    assert "sensitive provider detail" not in repr(invoke_config)
    assert "callbacks" not in invoke_config
