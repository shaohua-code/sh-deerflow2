"""Flow Desk 可使用的 owner-scoped 删除能力。"""

from __future__ import annotations

import asyncio
import inspect
import re
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any


class GatewayOwnerDataDeleter:
    """转发给 Gateway 已有的受 owner 检查仓储操作，不暴露宿主数据库。"""

    def __init__(
        self,
        *,
        scheduled_task_repository: Any | None,
        agent_store: Any | None = None,
        project_repository: Any | None = None,
        project_document_repository: Any | None = None,
        memory_manager: Any | None = None,
        app: Any | None = None,
    ) -> None:
        self._scheduled_task_repository = scheduled_task_repository
        self._agent_store = agent_store
        self._project_repository = project_repository
        self._project_document_repository = project_document_repository
        self._memory_manager = memory_manager
        self._app = app

    async def delete_scheduled_task(self, *, user_id: str, task_id: str) -> str | None:
        """删除一项 owner 的计划定义；运行中的任务会返回 ``executing``。

        计划任务仓储在持锁事务内再次核对 owner，并保护 queued/launching/running
        生命周期。本删除只处理定义与排队 occurrence，不触碰执行历史和会话内容。
        """
        if not isinstance(user_id, str) or not user_id or len(user_id) > 255:
            raise ValueError("Invalid scheduled-task deletion owner")
        if not isinstance(task_id, str) or not task_id or len(task_id) > 64:
            raise ValueError("Invalid scheduled-task deletion ID")
        repository = self._scheduled_task_repository
        if repository is None:
            return None
        return await repository.delete_with_queue_cancellation(
            task_id,
            user_id=user_id,
            error="scheduled task definition deleted by its owner",
            now=datetime.now(UTC),
        )

    async def delete_agent(self, *, user_id: str, name: str) -> str | None:
        """删除当前用户的自建 Agent，并沿用 Gateway 对记忆写队列的取消保护。"""
        if not isinstance(user_id, str) or not user_id or len(user_id) > 255:
            raise ValueError("Invalid Agent deletion owner")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,64}", name):
            raise ValueError("Invalid Agent deletion name")
        store = self._agent_store
        if store is None:
            return None

        # 复用普通 Agent 删除的前后 memory debounce 取消，避免留下延迟写入。
        from app.gateway.agent_deletion import delete_agent_with_memory_cancel

        outcome = await asyncio.to_thread(
            delete_agent_with_memory_cancel,
            store,
            name.lower(),
            user_id,
        )
        # 公开扩展契约使用稳定的下划线结果名，与 harness 内部 Literal 解耦。
        return {
            "missing": "not_found",
            "not-custom-agent": "not_custom_agent",
        }.get(outcome, outcome)

    async def delete_thread(self, *, user_id: str, thread_id: str) -> str | None:
        """清除 owner 会话和由 Gateway 管理的关联历史。

        获取 durable delete reservation 前会重新检查持久化 owner；随后复用
        Gateway 路由的清理 helper，按顺序删除工作区、checkpoint、事件、run 用量和元数据。
        """
        if not isinstance(user_id, str) or not user_id or len(user_id) > 255:
            raise ValueError("Invalid thread deletion owner")
        if not isinstance(thread_id, str) or not thread_id or len(thread_id) > 255:
            raise ValueError("Invalid thread deletion ID")
        app = self._app
        if app is None:
            return None

        from app.gateway.deps import get_run_manager, get_thread_store
        from app.gateway.routers.threads import _delete_thread_data_with_reservation
        from app.gateway.services import goal_thread_lock
        from deerflow.runtime import ThreadOperationKind
        from deerflow.runtime.runs.manager import ConflictError

        # Route helpers only need request.app.state. This small adapter lets the
        # owner-scoped background worker reuse the exact HTTP deletion sequence.
        request = SimpleNamespace(app=app)
        thread_store = get_thread_store(request)
        thread = await thread_store.get(thread_id, user_id=user_id)
        if thread is None or thread.get("user_id") != user_id:
            return "not_found"

        try:
            async with goal_thread_lock(thread_id):
                async with get_run_manager(request).reserve_thread_operation(
                    thread_id,
                    kind=ThreadOperationKind.delete,
                    user_id=user_id,
                ):
                    await _delete_thread_data_with_reservation(
                        thread_id,
                        request,
                        user_id=user_id,
                    )
        except ConflictError:
            # Active runs/other thread mutations are kept for a later retry.
            return "executing"
        return "deleted"

    @property
    def supports_file_delete(self) -> bool:
        """文件删除至少需要 Gateway app，具体文件类型仍逐项失败关闭。"""
        return self._app is not None

    async def delete_file(self, *, user_id: str, file_id: str) -> str | None:
        """删除一项本人上传文件或把本人项目资料移入回收站。

        输入是 owner reader 生成的不透明 ID，绝不转换成任意宿主路径。输出文件和
        工作区文件暂时没有适合后台清理的宿主 API，因此明确返回 ``unsupported``。
        """
        if not isinstance(user_id, str) or not user_id or len(user_id) > 255:
            raise ValueError("Invalid file deletion owner")
        if not isinstance(file_id, str) or not file_id or len(file_id) > 8192:
            raise ValueError("Invalid file deletion ID")
        if self._app is None:
            return None

        if file_id.startswith("thread_upload:"):
            try:
                thread_id, filename = file_id.removeprefix("thread_upload:").split(":", 1)
            except ValueError:
                return "invalid"
            if not thread_id or len(thread_id) > 255 or not filename or len(filename) > 255 or filename in {".", ".."} or "/" in filename or "\\" in filename:
                return "invalid"

            from app.gateway.deps import get_thread_store
            from app.gateway.routers.uploads import _delete_uploaded_file_for_thread
            from deerflow.uploads.manager import PathTraversalError

            request = SimpleNamespace(app=self._app)
            thread = await get_thread_store(request).get(thread_id, user_id=user_id)
            if thread is None or thread.get("user_id") != user_id:
                return "not_found"
            try:
                await asyncio.to_thread(
                    _delete_uploaded_file_for_thread,
                    thread_id,
                    filename,
                    user_id,
                )
            except FileNotFoundError:
                return "not_found"
            except (PathTraversalError, ValueError):
                return "invalid"

            from app.gateway.action_audit import notify_action_audit

            await notify_action_audit(
                request,
                action="upload.delete",
                resource_type="thread_upload",
                # 文件名可能由用户提供；审计只记录线程 ID。
                resource_id=thread_id,
                actor_user_id=user_id,
            )
            return "deleted"

        if file_id.startswith("project-document:"):
            try:
                project_id, document_id = file_id.removeprefix("project-document:").split(":", 1)
            except ValueError:
                return "invalid"
            if not project_id or len(project_id) > 255 or not document_id or len(document_id) > 255:
                return "invalid"
            repository = self._project_document_repository
            trash = getattr(repository, "trash", None)
            if not callable(trash):
                return None

            # 仓储会在事务内同时校验 document、project 与显式 owner。
            trashed = await trash(document_id, project_id=project_id, user_id=user_id)
            if not trashed:
                return "not_found"

            from app.gateway.action_audit import notify_action_audit

            await notify_action_audit(
                SimpleNamespace(app=self._app),
                action="project.document.trash",
                resource_type="project_document",
                resource_id=document_id,
                actor_user_id=user_id,
            )
            return "trashed"

        if file_id.startswith(("thread_output:", "thread_workspace:")):
            return "unsupported"
        return "invalid"

    @property
    def supports_project_delete(self) -> bool:
        """只有仓储提供显式 owner 参数时才开放项目删除 capability。"""
        delete = getattr(self._project_repository, "delete", None)
        if not callable(delete):
            return False
        try:
            parameters = inspect.signature(delete).parameters.values()
        except (TypeError, ValueError):
            return False
        return any(parameter.name == "user_id" or parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters)

    async def delete_project(self, *, user_id: str, project_id: str) -> str | None:
        """移除明确 owner 的项目定义，沿用 Gateway 的事务与回收站语义。"""
        if not isinstance(user_id, str) or not user_id or len(user_id) > 255:
            raise ValueError("Invalid project deletion owner")
        if not isinstance(project_id, str) or not project_id or len(project_id) > 255:
            raise ValueError("Invalid project deletion ID")
        repository = self._project_repository
        delete = getattr(repository, "delete", None)
        if not self.supports_project_delete or not callable(delete):
            return None
        # ProjectRepository atomically detaches owned threads and moves active
        # shelf documents to Trash while deleting the owner-checked project row.
        deleted = await delete(project_id, user_id=user_id)
        if not deleted:
            return "not_found"
        if self._app is not None:
            from app.gateway.action_audit import notify_action_audit

            await notify_action_audit(
                SimpleNamespace(app=self._app),
                action="project.delete",
                resource_type="project",
                resource_id=project_id,
                actor_user_id=user_id,
            )
        return "deleted"

    def _memory_manager_with_clear_support(self) -> Any | None:
        """只把真正覆写 clear_memory 的配置后端视为可清理能力。"""
        try:
            from deerflow.agents.memory import MemoryManager, get_memory_manager

            manager = self._memory_manager if self._memory_manager is not None else get_memory_manager()
        except Exception:
            # 能力探测失败必须关闭；数据任务 API 会向用户返回不可用，而不会排入假成功任务。
            return None

        clear_memory = getattr(manager, "clear_memory", None)
        if not callable(clear_memory) or getattr(type(manager), "clear_memory", None) is MemoryManager.clear_memory:
            return None
        return manager

    @property
    def supports_memory_clear(self) -> bool:
        """仅在已配置后端覆写清空操作时开放账号记忆范围删除。"""
        return self._memory_manager_with_clear_support() is not None

    async def delete_memory(self, *, user_id: str) -> str | None:
        """调用记忆管理器的 owner 范围清空；记忆队列保护由后端自身实现。"""
        if not isinstance(user_id, str) or not user_id or len(user_id) > 255:
            raise ValueError("Invalid memory deletion owner")
        manager = self._memory_manager_with_clear_support()
        if manager is None:
            return None
        try:
            # 复用 HTTP memory API 所用的公开管理器契约，不读取存储路径或后端私有表。
            await asyncio.to_thread(manager.clear_memory, user_id=user_id)
        except NotImplementedError:
            # 配置热变更或第三方后端不再支持时，worker 必须失败关闭。
            return None
        return "deleted"

    @property
    def supports_custom_skills_delete(self) -> bool:
        """仅当用户隔离存储实现了专属清理接口时开放此能力。"""
        try:
            from deerflow.skills.storage.user_scoped_skill_storage import UserScopedSkillStorage
        except Exception:
            return False
        return callable(getattr(UserScopedSkillStorage, "purge_custom_skills", None))

    async def delete_custom_skills(self, *, user_id: str) -> str | None:
        """清理显式 owner 的自定义技能，并仅刷新该用户的提示缓存。"""
        if not isinstance(user_id, str) or not user_id or len(user_id) > 255:
            raise ValueError("Invalid custom-skill deletion owner")
        if not self.supports_custom_skills_delete:
            return None

        from deerflow.config.paths import make_safe_user_id
        from deerflow.skills.storage import get_or_new_user_skill_storage

        storage = get_or_new_user_skill_storage(user_id)
        expected_owner = make_safe_user_id(user_id)
        purge = getattr(storage, "purge_custom_skills", None)
        if getattr(storage, "user_id", None) != expected_owner or not callable(purge):
            return None

        await asyncio.to_thread(purge)
        from deerflow.agents.lead_agent.prompt import refresh_user_skills_system_prompt_cache_async

        await refresh_user_skills_system_prompt_cache_async(user_id)
        return "deleted"
