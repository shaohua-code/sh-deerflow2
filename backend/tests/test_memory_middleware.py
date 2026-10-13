from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.runtime import Runtime

from deerflow.agents.middlewares import memory_middleware as memory_middleware_module
from deerflow.agents.middlewares.memory_middleware import MemoryMiddleware
from deerflow.config.memory_config import MemoryConfig


def test_after_agent_queues_memory_under_runtime_user(monkeypatch):
    manager = MagicMock()
    monkeypatch.setattr(memory_middleware_module, "get_memory_manager", lambda: manager)
    monkeypatch.setattr(memory_middleware_module, "is_memory_scope_authorized_sync", lambda *args, **kwargs: True)

    middleware = MemoryMiddleware(
        agent_name="researcher",
        memory_config=MemoryConfig(enabled=True),
    )
    runtime = Runtime(
        context={
            "thread_id": "thread-123",
            "user_id": "runtime-user",
        }
    )

    result = middleware.after_agent(
        {
            "messages": [
                HumanMessage(content="Remember this"),
                AIMessage(content="Understood"),
            ]
        },
        runtime,
    )

    assert result is None
    manager.add.assert_called_once()
    call = manager.add.call_args
    assert call.args[:2] == (
        "thread-123",
        [
            HumanMessage(content="Remember this"),
            AIMessage(content="Understood"),
        ],
    )
    assert call.kwargs["agent_name"] == "researcher"
    assert call.kwargs["user_id"] == "runtime-user"
    # Entry points always bind a trace id, so the memory queue -- which fires
    # on a Timer thread that inherits no ContextVars -- always gets a real one
    # captured at enqueue time rather than a None it would have to guard.
    assert call.kwargs["trace_id"]


def test_after_agent_does_not_enqueue_when_central_scope_is_denied(monkeypatch):
    manager = MagicMock()
    monkeypatch.setattr(memory_middleware_module, "get_memory_manager", lambda: manager)
    monkeypatch.setattr(memory_middleware_module, "is_memory_scope_authorized_sync", lambda *args, **kwargs: False)

    middleware = MemoryMiddleware(memory_config=MemoryConfig(enabled=True))
    runtime = Runtime(context={"thread_id": "thread-123", "user_id": "runtime-user"})

    result = middleware.after_agent(
        {"messages": [HumanMessage(content="Remember this"), AIMessage(content="Understood")]},
        runtime,
    )

    assert result is None
    manager.add.assert_not_called()


@pytest.mark.asyncio
async def test_aafter_agent_does_not_enqueue_when_central_scope_is_denied(monkeypatch):
    manager = MagicMock()
    manager.aadd = AsyncMock()
    monkeypatch.setattr(memory_middleware_module, "get_memory_manager", lambda: manager)
    monkeypatch.setattr(memory_middleware_module, "is_memory_scope_authorized", AsyncMock(return_value=False))

    middleware = MemoryMiddleware(memory_config=MemoryConfig(enabled=True))
    runtime = Runtime(context={"thread_id": "thread-123", "user_id": "runtime-user"})

    result = await middleware.aafter_agent(
        {"messages": [HumanMessage(content="Remember this"), AIMessage(content="Understood")]},
        runtime,
    )

    assert result is None
    memory_middleware_module.is_memory_scope_authorized.assert_awaited_once()
    manager.aadd.assert_not_awaited()
