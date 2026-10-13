"""Gateway 业务操作的产品审计通知。

产品扩展负责把事件写入自己的审计表；Gateway 只提交稳定标识和服务端
生成的操作者/追踪信息，不把文件名、消息内容或其他请求正文放进审计事件。
"""

import hashlib
from datetime import UTC, datetime
from typing import Literal

from deerflow_extension_api import AdminActionEvent
from fastapi import Request

from deerflow.extensions.notify import notify_admin_action
from deerflow.runtime.user_context import get_effective_user_id
from deerflow.trace_context import ensure_trace_id


async def notify_action_audit(
    request: Request,
    *,
    action: str,
    resource_type: str,
    resource_id: str | None,
    actor_user_id: str | None = None,
    outcome: Literal["success", "failure", "not_found"] = "success",
) -> None:
    """把完成或部分失败的 Gateway 操作交给产品扩展，审计失败不回滚业务结果。

    AdminActionObserver 是当前公开的主机审计扩展点。这里沿用它的稳定契约，
    让产品自己的文件/会话操作也能进入同一张审计表；类型名暂时保留历史兼容名。
    """
    app_state = getattr(getattr(request, "app", None), "state", None)
    extensions = getattr(app_state, "extensions", None)
    observers = getattr(extensions, "admin_action_observers", ())
    if not isinstance(observers, tuple) or not observers:
        # 普通 DeerFlow 部署可能没有 Flow Desk 审计扩展；不影响主机操作。
        return
    if resource_id is not None and len(resource_id) > 255:
        # 产品审计表把资源 ID 限制在 255 字符；超长旧 ID 用摘要保留稳定关联。
        resource_id = f"sha256:{hashlib.sha256(resource_id.encode('utf-8')).hexdigest()}"

    # 匿名的注册/首次初始化请求在 ContextVar 中没有已认证操作者；只有路由在
    # 用户成功持久化后，才能把该服务端生成的用户 ID 显式传进来作为审计主体。
    verified_actor_user_id = actor_user_id if actor_user_id is not None else get_effective_user_id()
    await notify_admin_action(
        extensions,
        AdminActionEvent(
            actor_user_id=str(verified_actor_user_id),
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            outcome=outcome,
            occurred_at=datetime.now(UTC),
            request_id=ensure_trace_id(),
        ),
    )
