"""Gateway 自建 Agent 删除的共享生命周期处理。"""

from __future__ import annotations

import logging
from typing import Any

from deerflow.persistence.agents import AgentDeleteOutcome

logger = logging.getLogger(__name__)


def delete_agent_with_memory_cancel(
    store: Any,
    name: str,
    user_id: str | None,
) -> AgentDeleteOutcome:
    """在删除 Agent 配置/同目录记忆前后取消延迟记忆写入。"""
    _cancel_pending_memory_for_agent(name, user_id)
    outcome = store.delete(name, user_id=user_id)
    if outcome == "deleted":
        _cancel_pending_memory_for_agent(name, user_id)
    return outcome


def _cancel_pending_memory_for_agent(name: str, user_id: str | None) -> None:
    """Best-effort cancel of buffered memory extraction for one Agent scope."""
    try:
        from deerflow.agents.memory.manager import get_memory_manager

        cancelled = get_memory_manager().cancel_by_agent(name, user_id=user_id)
        if cancelled:
            logger.info("Cancelled %d pending memory update(s) for agent '%s'", cancelled, name)
    except Exception:
        # 保持现有路由语义：取消缓冲写入为 best-effort，不扩大删除范围。
        logger.warning(
            "Failed to cancel pending memory updates for agent '%s' (non-fatal)",
            name,
            exc_info=True,
        )
