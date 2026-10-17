"""Regression coverage for IAM vault revalidation at Agent run admission."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from deerflow.runtime.runs.manager import RunRecord, RunStartOutcome
from deerflow.runtime.runs.schemas import DisconnectMode, RunStatus
from deerflow.runtime.runs.worker import RunContext, run_agent


class _Credentials(dict[str, str]):
    def __init__(self, events: list[str], *, error: Exception | None = None) -> None:
        super().__init__(
            iam_access_token="short-lived-access",
            iam_subject="subject-1",
            iam_tenant_id="tenant-1",
        )
        self.events = events
        self.error = error

    async def refresh_if_needed(self, *, force: bool = False) -> None:
        assert force is True
        self.events.append("session-revalidated")
        if self.error is not None:
            raise self.error


class _FakeAgent:
    checkpointer = None
    store = None
    interrupt_before_nodes: list[str] = []
    interrupt_after_nodes: list[str] = []

    async def astream(self, _graph_input: Any, *, config: dict[str, Any], **_kwargs: Any):
        self.config = config
        return
        yield  # pragma: no cover - make this an async generator


class _FakeRunManager:
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.errors: list[str | None] = []

    async def wait_for_prior_finalizing(self, *_args: Any, **_kwargs: Any) -> None:
        return None

    async def try_start(self, _run_id: str) -> RunStartOutcome:
        self.events.append("run-started")
        return RunStartOutcome.started

    async def has_later_run(self, *_args: Any, **_kwargs: Any) -> bool:
        return False

    async def has_later_started_run(self, *_args: Any, **_kwargs: Any) -> bool:
        return False

    async def set_status(self, *_args: Any, **_kwargs: Any) -> None:
        return None

    async def set_status_if_not_cancelled(
        self,
        _run_id: str,
        _status: RunStatus,
        *,
        error: str | None = None,
        **_kwargs: Any,
    ) -> None:
        self.errors.append(error)
        return None

    async def update_model_name(self, *_args: Any, **_kwargs: Any) -> None:
        return None

    async def update_run_completion(self, *_args: Any, **_kwargs: Any) -> None:
        return None

    async def cleanup(self, *_args: Any, **_kwargs: Any) -> None:
        return None


class _FakeBridge:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    async def publish(self, _run_id: str, event: str, payload: dict[str, Any]) -> None:
        if event == "error":
            self.events.append((event, payload))

    async def publish_end(self, _run_id: str) -> None:
        return None

    async def cleanup(self, _run_id: str, *, delay: int = 0) -> None:
        return None


async def _run(
    *,
    credentials: _Credentials,
    agent_factory: Any,
    run_manager: _FakeRunManager,
    bridge: _FakeBridge,
) -> None:
    record = RunRecord(
        run_id="run-iam-admission",
        thread_id="thread-iam-admission",
        assistant_id="lead-agent",
        status=RunStatus.pending,
        on_disconnect=DisconnectMode.cancel,
    )
    record.abort_event = asyncio.Event()

    await run_agent(
        bridge,
        run_manager,
        record,
        ctx=RunContext(checkpointer=None, authorization_credentials=credentials),
        agent_factory=agent_factory,
        graph_input={"messages": []},
        config={"configurable": {"thread_id": record.thread_id}},
    )


@pytest.mark.asyncio
async def test_run_revalidates_iam_session_before_agent_assembly():
    events: list[str] = []
    credentials = _Credentials(events)
    run_manager = _FakeRunManager(events)
    bridge = _FakeBridge()
    agent = _FakeAgent()

    def agent_factory(**_kwargs: Any) -> _FakeAgent:
        events.append("agent-assembled")
        return agent

    await _run(
        credentials=credentials,
        agent_factory=agent_factory,
        run_manager=run_manager,
        bridge=bridge,
    )

    assert events[:3] == ["run-started", "session-revalidated", "agent-assembled"]
    assert bridge.events == []


@pytest.mark.asyncio
async def test_run_fails_closed_when_iam_session_revalidation_fails():
    events: list[str] = []
    credentials = _Credentials(events, error=RuntimeError("vault storage details"))
    run_manager = _FakeRunManager(events)
    bridge = _FakeBridge()
    assembly_attempted = False

    def agent_factory(**_kwargs: Any) -> _FakeAgent:
        nonlocal assembly_attempted
        assembly_attempted = True
        raise AssertionError("Agent assembly must not run for a revoked IAM session")

    await _run(
        credentials=credentials,
        agent_factory=agent_factory,
        run_manager=run_manager,
        bridge=bridge,
    )

    assert not assembly_attempted
    assert run_manager.errors == ["The IAM session is no longer active for this run"]
    assert bridge.events == [
        (
            "error",
            {
                "message": "The IAM session is no longer active for this run",
                "name": "RuntimeError",
            },
        )
    ]
    assert "vault storage details" not in repr(bridge.events)
