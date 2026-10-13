"""为受信任 Gateway 扩展提供只读、按用户隔离的数据访问。

Flow Desk 产品扩展只能通过公开的 ``OwnerDataReader`` 契约读取资料，不直接依赖
Gateway 仓储实现或 checkpoint 私有表。调用方必须明确传入 user ID；读取会话和消息时
分别重验线程归属，避免一个 owner 的任务误读另一个 owner 的资源。
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import stat
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from deerflow_extension_api import (
    OwnerAgentPage,
    OwnerFile,
    OwnerFileEntry,
    OwnerFilePage,
    OwnerFiles,
    OwnerMessagePage,
    OwnerProjectPage,
    OwnerRunPage,
    OwnerScheduledTaskPage,
    OwnerThreadPage,
)

from app.gateway.conversation_reader import read_visible_message_page
from deerflow.config.agents_config import AgentConfig
from deerflow.config.paths import Paths, get_paths
from deerflow.projects.documents import check_document_content, resolve_document_paths
from deerflow.uploads.manager import (
    is_upload_staging_file,
    output_artifact_url,
    upload_artifact_url,
)
from deerflow.workspace_changes.scanner import EXCLUDED_DIR_NAMES, is_sensitive_workspace_path

_MAX_THREAD_PAGE = 200
_MAX_PROJECT_PAGE = 200
_MAX_SCHEDULED_TASK_PAGE = 200
_MAX_AGENT_PAGE = 100
_MAX_FILE_COUNT = 5_001
_MAX_FILE_BYTES = 7 * 1024 * 1024
_MAX_FILE_THREAD_SCAN = 5_000
_MAX_FILE_PROJECT_SCAN = 5_000
_MAX_FILE_CATALOG_ENTRIES = 10_000
# 工作区会递归扫描，分别限制单个会话与整次任务的目录数，防止大目录拖慢 Gateway。
_MAX_FILE_WORKSPACE_DIRECTORIES = 200
_MAX_FILE_WORKSPACE_SCAN_DIRECTORIES = 20_000
_MAX_FILE_QUERY_LENGTH = 200
_MAX_MESSAGE_PAGE = 200
_MAX_RUN_PAGE = 200
_MESSAGE_SCAN_BATCH = 201
_MEMORY_FACT_FIELDS = {
    "id",
    "content",
    "category",
    "categoryExtension",
    "topics",
    "confidence",
    "createdAt",
    "source",
    "sourceError",
    "status",
    "consolidatedAt",
    "consolidatedFrom",
}
_MEMORY_CONTEXT_SECTIONS = {
    "user": ("workContext", "personalContext", "topOfMind"),
    "history": ("recentMonths", "earlierContext", "longTermBackground"),
}


class GatewayOwnerDataReader:
    """把 Gateway 内部存储投影成扩展 API 可安全使用的用户资料视图。

    这里是宿主与自有产品扩展之间的隔离适配层：先由 Gateway 按 owner 过滤，
    再把有限字段包装成 extension-api DTO；不要向扩展泄漏仓储对象或磁盘绝对路径。
    """

    def __init__(
        self,
        thread_store: Any,
        event_store: Any,
        run_manager: Any,
        *,
        run_store: Any | None = None,
        project_repository: Any | None = None,
        scheduled_task_repository: Any | None = None,
        agent_store: Any | None = None,
        memory_manager: Any | None = None,
        project_document_repository: Any | None = None,
        paths: Paths | None = None,
    ) -> None:
        self._thread_store = thread_store
        self._event_store = event_store
        self._run_manager = run_manager
        self._run_store = run_store
        self._project_repository = project_repository
        self._scheduled_task_repository = scheduled_task_repository
        self._agent_store = agent_store
        self._memory_manager = memory_manager
        self._project_document_repository = project_document_repository
        self._paths = paths

    async def list_threads(
        self,
        *,
        user_id: str,
        limit: int,
        offset: int,
    ) -> OwnerThreadPage:
        """Return a bounded page without arbitrary metadata or another owner's rows."""
        self._validate_owner(user_id)
        if not 1 <= limit <= _MAX_THREAD_PAGE:
            raise ValueError(f"limit must be between 1 and {_MAX_THREAD_PAGE}")
        if offset < 0:
            raise ValueError("offset must be non-negative")

        rows = await self._thread_store.search(
            limit=limit + 1,
            offset=offset,
            user_id=user_id,
        )
        # 仓储查询已经按 user_id 过滤；这里再做一次边界检查，避免未来的适配器
        # 出错后把其他用户的数据带进导出包。
        owned = [self._project_thread(row) for row in rows if isinstance(row, dict) and row.get("user_id") == user_id]
        page_threads = tuple(owned[:limit])
        has_more = len(owned) > limit
        return OwnerThreadPage(
            threads=page_threads,
            has_more=has_more,
            next_offset=offset + limit if has_more else None,
        )

    async def list_projects(
        self,
        *,
        user_id: str,
        limit: int,
        offset: int,
    ) -> OwnerProjectPage | None:
        """按用户分页读取项目元数据，绝不包含项目文档正文或文件字节。"""
        self._validate_owner(user_id)
        if not 1 <= limit <= _MAX_PROJECT_PAGE:
            raise ValueError(f"limit must be between 1 and {_MAX_PROJECT_PAGE}")
        if offset < 0:
            raise ValueError("offset must be non-negative")
        repository = self._project_repository
        if repository is None:
            return None

        rows = await repository.list(user_id=user_id, limit=limit + 1, offset=offset)
        # 仓储查询按 owner 过滤后，这里再次验证所有权并只导出明确白名单字段。
        owned = [self._project_project(row) for row in rows if isinstance(row, dict) and row.get("user_id") == user_id]
        page_projects = tuple(owned[:limit])
        has_more = len(owned) > limit
        return OwnerProjectPage(
            projects=page_projects,
            has_more=has_more,
            next_offset=offset + limit if has_more else None,
        )

    async def list_scheduled_tasks(
        self,
        *,
        user_id: str,
        limit: int,
        offset: int,
    ) -> OwnerScheduledTaskPage | None:
        """按 owner 分页读取计划定义，不导出运行历史、错误或租约字段。"""
        self._validate_owner(user_id)
        if not 1 <= limit <= _MAX_SCHEDULED_TASK_PAGE:
            raise ValueError(f"limit must be between 1 and {_MAX_SCHEDULED_TASK_PAGE}")
        if offset < 0:
            raise ValueError("offset must be non-negative")
        repository = self._scheduled_task_repository
        if repository is None:
            return None

        rows = await repository.list_by_user(user_id, limit=limit + 1, offset=offset)
        # 仓储按 owner 过滤；二次检查并只投影任务定义，避免运行字段进入导出包。
        owned = [self._project_scheduled_task(row) for row in rows if isinstance(row, dict) and row.get("user_id") == user_id]
        page_tasks = tuple(owned[:limit])
        has_more = len(owned) > limit
        return OwnerScheduledTaskPage(
            tasks=page_tasks,
            has_more=has_more,
            next_offset=offset + limit if has_more else None,
        )

    async def list_agents(
        self,
        *,
        user_id: str,
        limit: int,
        offset: int,
    ) -> OwnerAgentPage | None:
        """Read exact-owner custom Agents through a field-allowlisted projection."""
        self._validate_owner(user_id)
        if not 1 <= limit <= _MAX_AGENT_PAGE:
            raise ValueError(f"limit must be between 1 and {_MAX_AGENT_PAGE}")
        if offset < 0:
            raise ValueError("offset must be non-negative")
        store = self._agent_store
        if store is None:
            return None

        # AgentStore is synchronous (file or SQL); keep IO off the async Gateway
        # loop and request one extra row to determine the page cursor.
        rows = await asyncio.to_thread(
            store.list_owned,
            user_id=user_id,
            limit=limit + 1,
            offset=offset,
        )
        projected: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, tuple) or len(row) != 3 or row[0] != user_id or not isinstance(row[1], AgentConfig):
                # Fail closed if storage ever returns shared or foreign data.
                raise RuntimeError("Agent store returned a row outside the requested owner scope")
            projected.append(self._project_agent(row[1], row[2]))
        page_agents = tuple(projected[:limit])
        has_more = len(projected) > limit
        return OwnerAgentPage(
            agents=page_agents,
            has_more=has_more,
            next_offset=offset + limit if has_more else None,
        )

    async def read_memory(self, *, user_id: str) -> dict[str, Any] | None:
        """按显式 owner 读取记忆，并移除后端私有字段与内部存储版本号。"""
        self._validate_owner(user_id)
        manager = self._memory_manager
        if manager is None:
            # The background worker has no HTTP ContextVar. Always pass the
            # persisted job owner into the memory backend explicitly.
            from deerflow.agents.memory import get_memory_manager

            manager = await asyncio.to_thread(get_memory_manager)
        try:
            source = await asyncio.to_thread(manager.get_memory, user_id=user_id)
        except NotImplementedError:
            return None
        if not isinstance(source, dict):
            raise RuntimeError("Memory manager returned an invalid document")

        document: dict[str, Any] = {}
        for key in ("version", "lastUpdated"):
            value = source.get(key)
            if isinstance(value, str):
                document[key] = value

        for group, section_names in _MEMORY_CONTEXT_SECTIONS.items():
            source_group = source.get(group)
            if not isinstance(source_group, dict):
                continue
            projected_group: dict[str, Any] = {}
            for section_name in section_names:
                section = source_group.get(section_name)
                if not isinstance(section, dict):
                    continue
                projected_group[section_name] = {key: section[key] for key in ("summary", "updatedAt") if isinstance(section.get(key), str)}
            if projected_group:
                document[group] = projected_group

        facts = source.get("facts")
        if isinstance(facts, list):
            projected_facts = []
            for fact in facts:
                if not isinstance(fact, dict):
                    continue
                projected_fact = {key: value for key, value in fact.items() if key in _MEMORY_FACT_FIELDS}
                # Never preserve backend-private objects or structured identity
                # metadata inside otherwise portable fact fields.
                if "source" in projected_fact and not isinstance(projected_fact["source"], str):
                    projected_fact.pop("source")
                projected_facts.append(projected_fact)
            document["facts"] = projected_facts
        else:
            document["facts"] = []
        return document

    async def read_files(
        self,
        *,
        user_id: str,
        max_files: int,
        max_total_bytes: int,
    ) -> OwnerFiles | None:
        """Read bounded user files without exposing host paths to extensions.

        Only flat thread uploads/outputs and active originals from the user's
        project document shelves are included. Workspace files, derived
        previews, arbitrary paths, and deployment-wide storage are excluded.
        Every file is re-authorized against its owner row immediately before
        its bytes are opened.
        """
        self._validate_owner(user_id)
        if not 1 <= max_files <= _MAX_FILE_COUNT:
            raise ValueError(f"max_files must be between 1 and {_MAX_FILE_COUNT}")
        if not 1 <= max_total_bytes <= _MAX_FILE_BYTES:
            raise ValueError(f"max_total_bytes must be between 1 and {_MAX_FILE_BYTES}")

        paths = self._paths or get_paths()
        references: list[dict[str, Any]] = []
        failed_count = 0
        truncated = False
        coverage_notes: list[str] = []
        workspace_directories_scanned = 0
        sensitive_workspace_paths_skipped = 0
        workspace_scan_limited = False

        # Gateway storage methods require an explicit owner. We still verify
        # every returned row because a future adapter must fail closed too.
        thread_rows = await self._thread_store.search(
            limit=_MAX_FILE_THREAD_SCAN + 1,
            offset=0,
            user_id=user_id,
        )
        if len(thread_rows) > _MAX_FILE_THREAD_SCAN:
            thread_rows = thread_rows[:_MAX_FILE_THREAD_SCAN]
            truncated = True
        for row in thread_rows:
            if not isinstance(row, dict) or row.get("user_id") != user_id:
                failed_count += 1
                continue
            thread_id = row.get("thread_id")
            if not isinstance(thread_id, str) or not thread_id:
                failed_count += 1
                continue
            for source in ("thread_upload", "thread_output", "thread_workspace"):
                if len(references) >= max_files:
                    truncated = True
                    break
                try:
                    directory = self._owned_thread_directory(paths, user_id, thread_id, source)
                    remaining = max_files - len(references)
                    if source == "thread_workspace":
                        remaining_directories = _MAX_FILE_WORKSPACE_SCAN_DIRECTORIES - workspace_directories_scanned
                        if remaining_directories <= 0:
                            truncated = True
                            workspace_scan_limited = True
                            break
                        entries, has_more, scan_failures, directories_scanned = await asyncio.to_thread(
                            _list_confined_workspace_files,
                            directory,
                            remaining,
                            min(_MAX_FILE_WORKSPACE_DIRECTORIES, remaining_directories),
                        )
                        failed_count += scan_failures
                        workspace_directories_scanned += directories_scanned
                        workspace_scan_limited = workspace_scan_limited or has_more
                        truncated = truncated or has_more
                        for item in entries:
                            if is_sensitive_workspace_path(item["name"]):
                                sensitive_workspace_paths_skipped += 1
                                continue
                            references.append(
                                {
                                    "source": source,
                                    "name": item["name"],
                                    "size_bytes": item["size_bytes"],
                                    "thread_id": thread_id,
                                }
                            )
                    else:
                        entries, has_more = await asyncio.to_thread(
                            _list_confined_regular_files,
                            directory,
                            remaining,
                        )
                        references.extend(
                            {
                                "source": source,
                                "name": item["name"],
                                "size_bytes": item["size_bytes"],
                                "thread_id": thread_id,
                            }
                            for item in entries
                        )
                except (OSError, ValueError):
                    failed_count += 1
                    continue
                truncated = truncated or has_more
                if source == "thread_workspace" and has_more:
                    workspace_scan_limited = True
            if len(references) >= max_files:
                truncated = True
                break

        if sensitive_workspace_paths_skipped:
            coverage_notes.append(f"Skipped {sensitive_workspace_paths_skipped} workspace files with sensitive-looking workspace paths.")
            coverage_notes.append("Workspace file contents are not scanned for secrets; review the export before sharing it.")
        if workspace_scan_limited:
            coverage_notes.append("Workspace scanning reached a per-thread directory, total directory, or file-count limit.")

        project_repository = self._project_repository
        document_repository = self._project_document_repository
        if project_repository is None or document_repository is None:
            coverage_notes.append("Project shelf originals were unavailable to the Gateway reader.")
        else:
            project_rows = await project_repository.list(
                user_id=user_id,
                limit=_MAX_FILE_PROJECT_SCAN + 1,
                offset=0,
            )
            if len(project_rows) > _MAX_FILE_PROJECT_SCAN:
                project_rows = project_rows[:_MAX_FILE_PROJECT_SCAN]
                truncated = True
            for project in project_rows:
                if not isinstance(project, dict) or project.get("user_id") != user_id:
                    failed_count += 1
                    continue
                project_id = project.get("id")
                if not isinstance(project_id, str) or not project_id:
                    failed_count += 1
                    continue
                remaining = max_files - len(references)
                if remaining <= 0:
                    truncated = True
                    break
                rows = await document_repository.list_active(
                    project_id,
                    limit=remaining + 1,
                    offset=0,
                    user_id=user_id,
                )
                if len(rows) > remaining:
                    rows = rows[:remaining]
                    truncated = True
                for document in rows:
                    if (
                        not isinstance(document, dict)
                        or document.get("user_id") != user_id
                        or document.get("project_id") != project_id
                        or not isinstance(document.get("id"), str)
                        or not isinstance(document.get("name"), str)
                        or not isinstance(document.get("stored_relpath"), str)
                        or not isinstance(document.get("size_bytes"), int)
                        or isinstance(document.get("size_bytes"), bool)
                    ):
                        failed_count += 1
                        continue
                    references.append(
                        {
                            "source": "project_document",
                            "name": document["name"],
                            "size_bytes": document["size_bytes"],
                            "project_id": project_id,
                            "document_id": document["id"],
                            "stored_relpath": document["stored_relpath"],
                            "sha256": document.get("sha256"),
                        }
                    )

        exported: list[OwnerFile] = []
        bytes_read = 0
        for reference in references:
            size_bytes = reference["size_bytes"]
            if size_bytes < 0:
                failed_count += 1
                continue
            remaining_bytes = max_total_bytes - bytes_read
            if size_bytes > remaining_bytes:
                truncated = True
                continue
            try:
                if reference["source"] in {"thread_upload", "thread_output", "thread_workspace"}:
                    thread_id = reference["thread_id"]
                    current_thread = await self._thread_store.get(thread_id, user_id=user_id)
                    if not isinstance(current_thread, dict) or current_thread.get("user_id") != user_id:
                        failed_count += 1
                        continue
                    if reference["source"] == "thread_workspace":
                        if is_sensitive_workspace_path(reference["name"]):
                            failed_count += 1
                            continue
                        directory = self._owned_thread_directory(
                            paths,
                            user_id,
                            thread_id,
                            "thread_workspace",
                        )
                        content = await asyncio.to_thread(
                            _read_confined_workspace_file,
                            directory,
                            reference["name"],
                            remaining_bytes,
                        )
                    else:
                        directory = self._owned_thread_directory(
                            paths,
                            user_id,
                            thread_id,
                            reference["source"],
                        )
                        content = await asyncio.to_thread(
                            _read_confined_regular_file,
                            directory,
                            reference["name"],
                            remaining_bytes,
                        )
                else:
                    row = await document_repository.get(reference["document_id"], user_id=user_id)
                    if (
                        not isinstance(row, dict)
                        or row.get("user_id") != user_id
                        or row.get("project_id") != reference["project_id"]
                        or row.get("id") != reference["document_id"]
                        or row.get("stored_relpath") != reference["stored_relpath"]
                        or row.get("name") != reference["name"]
                    ):
                        failed_count += 1
                        continue
                    if not await check_document_content(paths, user_id=user_id, row=row):
                        failed_count += 1
                        continue
                    projects_root = self._owned_project_directory(paths, user_id)
                    original, _derived = await asyncio.to_thread(
                        resolve_document_paths,
                        paths,
                        user_id=user_id,
                        relpath=row["stored_relpath"],
                        name=row["name"],
                    )
                    content = await asyncio.to_thread(
                        _read_confined_path,
                        projects_root,
                        original,
                        remaining_bytes,
                    )
                    expected_hash = row.get("sha256")
                    actual_hash = hashlib.sha256(content).hexdigest()
                    if isinstance(expected_hash, str) and actual_hash != expected_hash:
                        failed_count += 1
                        continue

                if len(content) != size_bytes:
                    failed_count += 1
                    continue
            except (OSError, ValueError, KeyError):
                failed_count += 1
                continue

            exported.append(
                OwnerFile(
                    source=reference["source"],
                    name=reference["name"],
                    size_bytes=len(content),
                    content=content,
                    thread_id=reference.get("thread_id"),
                    project_id=reference.get("project_id"),
                )
            )
            bytes_read += len(content)

        return OwnerFiles(
            files=tuple(exported),
            truncated=truncated,
            failed_count=failed_count,
            coverage_notes=tuple(coverage_notes),
        )

    async def list_files(
        self,
        *,
        user_id: str,
        limit: int,
        offset: int,
        query: str = "",
    ) -> OwnerFilePage:
        """为一个已认证用户构建有上限的文件元数据目录，不读取文件正文。

        文件清单即时从 Gateway 的权威仓储和 owner 目录计算，不建立第二份
        文件存储。返回的 URL 仍须经过原 Gateway 路由的 owner 校验才能打开。
        扫描达到上限时用 ``truncated`` 明示覆盖不完整，不能把本页总数当作
        用户所有文件的永久总量。
        """
        self._validate_owner(user_id)
        if not 1 <= limit <= _MAX_FILE_CATALOG_ENTRIES:
            raise ValueError(f"limit must be between 1 and {_MAX_FILE_CATALOG_ENTRIES}")
        if not 0 <= offset <= 1_000_000:
            raise ValueError("offset must be between 0 and 1000000")
        if not isinstance(query, str) or len(query) > _MAX_FILE_QUERY_LENGTH:
            raise ValueError(f"query must be at most {_MAX_FILE_QUERY_LENGTH} characters")

        needle = query.strip().casefold()
        paths = self._paths or get_paths()
        candidates: list[OwnerFileEntry] = []
        scanned_files = 0
        failed_count = 0
        truncated = False
        catalog_full = False
        workspace_directories_scanned = 0
        workspace_scan_limited = False
        coverage_notes: list[str] = []

        project_names: dict[str, str] = {}
        owned_projects: list[tuple[str, str]] = []
        project_repository = self._project_repository
        document_repository = self._project_document_repository
        if project_repository is None or document_repository is None:
            coverage_notes.append("Project shelf originals were unavailable to the Gateway reader.")
        else:
            projects = await project_repository.list(
                user_id=user_id,
                limit=_MAX_FILE_PROJECT_SCAN + 1,
                offset=0,
            )
            if len(projects) > _MAX_FILE_PROJECT_SCAN:
                projects = projects[:_MAX_FILE_PROJECT_SCAN]
                truncated = True
            for project in projects:
                if not isinstance(project, dict) or project.get("user_id") != user_id:
                    failed_count += 1
                    continue
                project_id = project.get("id")
                if not isinstance(project_id, str) or not project_id:
                    failed_count += 1
                    continue
                name = project.get("name")
                project_name = name if isinstance(name, str) else ""
                project_names[project_id] = project_name
                owned_projects.append((project_id, project_name))

        # 搜索只匹配文件名及关联会话/项目名；绝不为了检索而读取文件正文。
        def matches(*parts: str | None) -> bool:
            return not needle or needle in " ".join(part for part in parts if part).casefold()

        thread_rows = await self._thread_store.search(
            limit=_MAX_FILE_THREAD_SCAN + 1,
            offset=0,
            user_id=user_id,
        )
        if len(thread_rows) > _MAX_FILE_THREAD_SCAN:
            thread_rows = thread_rows[:_MAX_FILE_THREAD_SCAN]
            truncated = True

        # 目录只公开当前用户的文件元数据；仓储按 user_id 查询后还要复核 owner。
        for row in thread_rows:
            if not isinstance(row, dict) or row.get("user_id") != user_id:
                failed_count += 1
                continue
            thread_id = row.get("thread_id")
            if not isinstance(thread_id, str) or not thread_id:
                failed_count += 1
                continue
            name_value = row.get("display_name")
            thread_name = name_value if isinstance(name_value, str) else ""
            project_id = row.get("project_id") if isinstance(row.get("project_id"), str) else None
            project_name = project_names.get(project_id or "")

            for source in ("thread_upload", "thread_output", "thread_workspace"):
                remaining = _MAX_FILE_CATALOG_ENTRIES - scanned_files
                if remaining <= 0:
                    truncated = True
                    catalog_full = True
                    break
                try:
                    directory = self._owned_thread_directory(paths, user_id, thread_id, source)
                    if source == "thread_workspace":
                        remaining_directories = _MAX_FILE_WORKSPACE_SCAN_DIRECTORIES - workspace_directories_scanned
                        if remaining_directories <= 0:
                            truncated = True
                            workspace_scan_limited = True
                            continue
                        entries, has_more, scan_failures, directories_scanned = await asyncio.to_thread(
                            _list_confined_workspace_files,
                            directory,
                            remaining + 1,
                            min(_MAX_FILE_WORKSPACE_DIRECTORIES, remaining_directories),
                        )
                        failed_count += scan_failures
                        workspace_directories_scanned += directories_scanned
                        workspace_scan_limited = workspace_scan_limited or has_more
                    else:
                        entries, has_more = await asyncio.to_thread(
                            _list_confined_regular_files,
                            directory,
                            remaining + 1,
                        )
                except (OSError, ValueError):
                    failed_count += 1
                    continue

                if len(entries) > remaining:
                    entries = entries[:remaining]
                    truncated = True
                    catalog_full = True
                scanned_files += len(entries)
                if has_more:
                    truncated = True
                for item in entries:
                    file_name = item.get("name")
                    size_bytes = item.get("size_bytes")
                    if not isinstance(file_name, str) or not file_name or not isinstance(size_bytes, int) or isinstance(size_bytes, bool) or size_bytes < 0:
                        failed_count += 1
                        continue
                    if not matches(file_name, thread_name, project_name):
                        continue
                    if source == "thread_upload":
                        artifact_url = upload_artifact_url(thread_id, file_name)
                    elif source == "thread_output":
                        artifact_url = output_artifact_url(thread_id, file_name)
                    else:
                        virtual_path = f"mnt/user-data/workspace/{file_name}"
                        artifact_url = f"/api/threads/{quote(thread_id, safe='')}/artifacts/{quote(virtual_path, safe='/')}"
                    candidates.append(
                        OwnerFileEntry(
                            file_id=f"{source}:{thread_id}:{file_name}",
                            source=source,
                            name=file_name,
                            storage_name=file_name,
                            size_bytes=size_bytes,
                            artifact_url=artifact_url,
                            modified_at=_modified_timestamp(item.get("modified")),
                            thread_id=thread_id,
                            thread_name=thread_name or None,
                            project_id=project_id,
                            project_name=project_name or None,
                        )
                    )
            if catalog_full:
                break

        # 仅追加当前用户项目资料架中的 active 原件；不枚举预览、回收站或工作区。
        if document_repository is not None and project_repository is not None and not catalog_full:
            for project_id, project_name in owned_projects:
                remaining = _MAX_FILE_CATALOG_ENTRIES - scanned_files
                if remaining <= 0:
                    truncated = True
                    break
                documents = await document_repository.list_active(
                    project_id,
                    limit=remaining + 1,
                    offset=0,
                    user_id=user_id,
                )
                if len(documents) > remaining:
                    documents = documents[:remaining]
                    truncated = True
                    catalog_full = True
                scanned_files += len(documents)
                for document in documents:
                    if (
                        not isinstance(document, dict)
                        or document.get("user_id") != user_id
                        or document.get("project_id") != project_id
                        or not isinstance(document.get("id"), str)
                        or not isinstance(document.get("name"), str)
                        or not isinstance(document.get("size_bytes"), int)
                        or isinstance(document.get("size_bytes"), bool)
                        or document.get("size_bytes", -1) < 0
                    ):
                        failed_count += 1
                        continue
                    file_name = document["name"]
                    if not matches(file_name, project_name):
                        continue
                    document_id = document["id"]
                    candidates.append(
                        OwnerFileEntry(
                            file_id=f"project-document:{project_id}:{document_id}",
                            source="project_document",
                            name=file_name,
                            # Project document paths remain in Gateway storage;
                            # the product page deletes by opaque document ID.
                            storage_name=None,
                            size_bytes=document["size_bytes"],
                            artifact_url=(f"/api/projects/{quote(project_id, safe='')}/documents/{quote(document_id, safe='')}/content?download=true"),
                            modified_at=_modified_timestamp(document.get("updated_at")),
                            project_id=project_id,
                            project_name=project_name or None,
                            document_id=document_id,
                        )
                    )
                if catalog_full:
                    break

        if truncated:
            coverage_notes.append("The file catalog reached a scan limit; matching results may be incomplete.")
        if workspace_scan_limited:
            coverage_notes.append("Workspace scanning reached a per-thread or total directory limit; some workspace files may be missing.")
        candidates.sort(
            key=lambda item: (
                -(item.modified_at or 0),
                item.name.casefold(),
                item.source,
                item.file_id,
            )
        )
        total = len(candidates)
        page = tuple(candidates[offset : offset + limit])
        has_more = offset + len(page) < total
        return OwnerFilePage(
            files=page,
            total=total,
            has_more=has_more,
            next_offset=offset + len(page) if has_more else None,
            truncated=truncated,
            failed_count=failed_count,
            coverage_notes=tuple(coverage_notes),
        )

    @staticmethod
    def _owned_thread_directory(paths: Paths, user_id: str, thread_id: str, source: str) -> Path:
        """Resolve a supported flat folder and reject redirected owner roots."""
        owner_root = GatewayOwnerDataReader._owned_user_root(paths, user_id)
        thread_parent = owner_root / "threads"
        thread_path = paths.thread_dir(thread_id, user_id=user_id)
        if _is_link_or_junction(thread_parent) or _is_link_or_junction(thread_path):
            raise ValueError("Thread storage must not redirect through symbolic links")
        thread_root = thread_path.resolve()
        if not thread_root.is_relative_to(owner_root):
            raise ValueError("Thread directory is outside its owner's storage root")
        if source == "thread_upload":
            directory = paths.sandbox_uploads_dir(thread_id, user_id=user_id)
        elif source == "thread_output":
            directory = paths.sandbox_outputs_dir(thread_id, user_id=user_id)
        elif source == "thread_workspace":
            directory = paths.sandbox_work_dir(thread_id, user_id=user_id)
        else:
            raise ValueError("Unsupported owner file source")
        user_data_path = thread_root / "user-data"
        if _is_link_or_junction(user_data_path) or _is_link_or_junction(directory):
            raise ValueError("Thread file directories must not redirect through symbolic links")
        resolved_directory = directory.resolve()
        if not resolved_directory.is_relative_to(thread_root):
            raise ValueError("Thread file directory is outside its thread root")
        return resolved_directory

    @staticmethod
    def _owned_user_root(paths: Paths, user_id: str) -> Path:
        """Reject owner namespace symlinks before deriving any data path."""
        users_root = paths.base_dir / "users"
        owner_path = paths.user_dir(user_id)
        if _is_link_or_junction(users_root) or _is_link_or_junction(owner_path):
            raise ValueError("User storage root must not redirect through a symbolic link")
        return owner_path.resolve()

    @staticmethod
    def _owned_project_directory(paths: Paths, user_id: str) -> Path:
        """Confine project document bytes to this owner's actual project root."""
        owner_root = GatewayOwnerDataReader._owned_user_root(paths, user_id)
        projects_path = paths.user_projects_dir(user_id)
        if projects_path.is_symlink():
            raise ValueError("Project storage root must not redirect through a symbolic link")
        projects_root = projects_path.resolve()
        if not projects_root.is_relative_to(owner_root):
            raise ValueError("Project storage is outside the owner's storage root")
        return projects_root

    async def read_thread_messages_page(
        self,
        *,
        user_id: str,
        thread_id: str,
        limit: int,
        before_seq: int | None = None,
    ) -> OwnerMessagePage | None:
        """Read only history visible through the Gateway's owner-checked API."""
        self._validate_owner(user_id)
        if not thread_id:
            raise ValueError("thread_id must not be empty")
        if not 1 <= limit <= _MAX_MESSAGE_PAGE:
            raise ValueError(f"limit must be between 1 and {_MAX_MESSAGE_PAGE}")
        if before_seq is not None and before_seq < 1:
            raise ValueError("before_seq must be positive")

        # 必须先从严格校验后的线程 metadata 确认归属，再读取历史；缺少 owner
        # 或属于旧版未归属线程的记录都不能通过此接口导出。
        thread = await self._thread_store.get(thread_id, user_id=user_id)
        if not isinstance(thread, dict) or thread.get("user_id") != user_id:
            return None

        messages, has_more = await read_visible_message_page(
            event_store=self._event_store,
            run_manager=self._run_manager,
            thread_id=thread_id,
            user_id=user_id,
            limit=limit,
            before_seq=before_seq,
            batch_size=_MESSAGE_SCAN_BATCH,
        )
        next_before_seq = messages[0].get("seq") if has_more and messages else None
        if has_more and not isinstance(next_before_seq, int):
            # 共用 reader 已校验 sequence；这里保留防御检查，避免未来替换实现后
            # 返回错误游标并造成重复读取或分页死循环。
            raise RuntimeError("Visible message page has no valid cursor")
        return OwnerMessagePage(
            messages=tuple(messages),
            has_more=has_more,
            next_before_seq=next_before_seq,
        )

    async def list_thread_runs(
        self,
        *,
        user_id: str,
        thread_id: str,
        limit: int,
        before_created_at: str | None = None,
        before_run_id: str | None = None,
    ) -> OwnerRunPage | None:
        """按双重 owner 检查提供安全运行摘要，不向产品扩展传入原始 RunRow。"""
        self._validate_owner(user_id)
        if not isinstance(thread_id, str) or not thread_id:
            raise ValueError("thread_id must not be empty")
        if not 1 <= limit <= _MAX_RUN_PAGE:
            raise ValueError(f"limit must be between 1 and {_MAX_RUN_PAGE}")
        if (before_created_at is None) != (before_run_id is None):
            raise ValueError("run cursor fields must be provided together")
        if before_created_at is not None and (not before_created_at or not before_run_id):
            raise ValueError("run cursor fields must not be empty")
        if before_created_at is not None and (len(before_created_at) > 64 or len(before_run_id) > 64):
            raise ValueError("run cursor fields are too long")

        # 会话仓储先确认归属；运行仓储再用相同 owner 查询，不能只依赖 thread_id。
        thread = await self._thread_store.get(thread_id, user_id=user_id)
        if not isinstance(thread, dict) or thread.get("user_id") != user_id:
            return None
        run_store = self._run_store
        if run_store is None:
            return None

        rows = await run_store.list_by_thread(
            thread_id,
            user_id=user_id,
            limit=limit + 1,
            before_created_at=before_created_at,
            before_run_id=before_run_id,
        )
        if not isinstance(rows, list) or len(rows) > limit + 1:
            raise RuntimeError("Run store returned an invalid owner page")

        projected: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict) or row.get("thread_id") != thread_id or row.get("user_id") != user_id or row.get("operation_kind", "run") != "run":
                # 仓储忽略 owner 条件时整个页面失败关闭，绝不尝试“过滤后继续”。
                raise RuntimeError("Run store returned a row outside the requested owner scope")
            run_id = row.get("run_id")
            if not isinstance(run_id, str) or not run_id or len(run_id) > 64:
                raise RuntimeError("Run store returned a row without a valid run_id")
            projected.append(self._project_run(row))

        page_runs = tuple(projected[:limit])
        has_more = len(projected) > limit
        next_created_at = page_runs[-1].get("created_at") if has_more and page_runs else None
        next_run_id = page_runs[-1].get("run_id") if has_more and page_runs else None
        if has_more and (not isinstance(next_created_at, str) or not isinstance(next_run_id, str)):
            raise RuntimeError("Run store returned an invalid owner cursor")
        return OwnerRunPage(
            runs=page_runs,
            has_more=has_more,
            next_before_created_at=next_created_at,
            next_before_run_id=next_run_id,
        )

    @staticmethod
    def _validate_owner(user_id: str) -> None:
        if not isinstance(user_id, str) or not user_id or len(user_id) > 255:
            raise ValueError("user_id must be a non-empty owner identifier")

    @staticmethod
    def _project_thread(row: dict[str, Any]) -> dict[str, Any]:
        """Project stable display fields and omit private/arbitrary metadata."""
        return {
            "thread_id": row.get("thread_id"),
            "display_name": row.get("display_name"),
            "status": row.get("status"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "project_id": row.get("project_id"),
        }

    @staticmethod
    def _project_run(row: dict[str, Any]) -> dict[str, Any]:
        """白名单导出运行摘要，排除请求、错误正文、metadata 和运行时 lease。"""
        result = {
            key: row.get(key)
            for key in (
                "run_id",
                "assistant_id",
                "status",
                "created_at",
                "updated_at",
                "total_input_tokens",
                "total_output_tokens",
                "total_tokens",
                "llm_call_count",
                "lead_agent_tokens",
                "subagent_tokens",
                "middleware_tokens",
            )
        }
        if not isinstance(result["assistant_id"], str) or len(result["assistant_id"]) > 128:
            result["assistant_id"] = None
        if result["status"] not in {"pending", "running", "success", "error", "timeout", "interrupted"}:
            result["status"] = "unknown"
        for key in ("created_at", "updated_at"):
            value = result[key]
            if not isinstance(value, str) or len(value) > 64:
                result[key] = None
        for key in (
            "total_input_tokens",
            "total_output_tokens",
            "total_tokens",
            "llm_call_count",
            "lead_agent_tokens",
            "subagent_tokens",
            "middleware_tokens",
        ):
            value = result[key]
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                result[key] = 0
        return result

    @staticmethod
    def _project_project(row: dict[str, Any]) -> dict[str, Any]:
        """投影项目资料字段，隔离 owner 列与未来新增的内部列。"""
        return {
            "id": row.get("id"),
            "name": row.get("name"),
            "instructions": row.get("instructions", ""),
            "presentation": row.get("presentation") or {},
            "status": row.get("status"),
            "created_at": row.get("created_at", ""),
            "updated_at": row.get("updated_at", ""),
        }

    @staticmethod
    def _project_scheduled_task(row: dict[str, Any]) -> dict[str, Any]:
        """仅保留可移交的计划定义字段，不泄露运行历史、错误和租约状态。"""
        return {
            "id": row.get("id"),
            "title": row.get("title"),
            "prompt": row.get("prompt"),
            "context_mode": row.get("context_mode"),
            "assistant_id": row.get("assistant_id"),
            "schedule_type": row.get("schedule_type"),
            "schedule_spec": row.get("schedule_spec") or {},
            "timezone": row.get("timezone"),
            "status": row.get("status"),
            "overlap_policy": row.get("overlap_policy"),
            "created_at": row.get("created_at", ""),
            "updated_at": row.get("updated_at", ""),
        }

    @staticmethod
    def _project_agent(config: AgentConfig, soul: str | None) -> dict[str, Any]:
        """只导出可移交的个人 Agent 字段；github 是部署绑定，不进入导出。"""
        return config.model_dump(
            mode="json",
            include={
                "name",
                "display_name",
                "description",
                "model",
                "tool_groups",
                "skills",
                "allowed_subagents",
                "model_settings",
                "thinking_enabled",
                "reasoning_effort",
                "memory_enabled",
            },
        ) | {"soul": soul or ""}


def _list_confined_regular_files(directory: Path, limit: int) -> tuple[list[dict[str, Any]], bool]:
    """List at most ``limit`` flat regular files, never following symlinks."""
    if limit < 1:
        return [], True
    if not directory.is_dir():
        return [], False

    root = directory.resolve(strict=True)
    files: list[dict[str, Any]] = []
    has_more = False
    with os.scandir(root) as entries:
        for entry in entries:
            if is_upload_staging_file(entry.name) or not entry.is_file(follow_symlinks=False):
                continue
            if len(files) >= limit:
                has_more = True
                break
            info = entry.stat(follow_symlinks=False)
            files.append({"name": entry.name, "size_bytes": info.st_size, "modified": info.st_mtime})
    return files, has_more


def _is_link_or_junction(path: Path) -> bool:
    """Treat Windows junctions like symbolic links at owner-storage boundaries."""
    if path.is_symlink():
        return True
    is_junction = getattr(path, "is_junction", None)
    return bool(is_junction()) if callable(is_junction) else False


def _list_confined_workspace_files(
    directory: Path,
    limit: int,
    directory_limit: int = _MAX_FILE_WORKSPACE_DIRECTORIES,
) -> tuple[list[dict[str, Any]], bool, int, int]:
    """List a bounded tree of workspace files without following links.

    Workspace file names are returned as relative POSIX paths so the frontend
    can open them through the existing owner-checked Gateway artifact route.
    Large generated trees and version-control metadata use the same excluded
    directory names as workspace-change scanning.
    """
    if limit < 1 or directory_limit < 1:
        return [], True, 0, 0
    if not directory.is_dir():
        return [], False, 0, 0

    root = directory.resolve(strict=True)
    excluded_dirs = {name.casefold() for name in EXCLUDED_DIR_NAMES}
    files: list[dict[str, Any]] = []
    failures = 0
    has_more = False
    directories_seen = 0

    def record_walk_error(_exc: OSError) -> None:
        nonlocal failures
        failures += 1

    for current_name, dirnames, filenames in os.walk(
        root,
        topdown=True,
        followlinks=False,
        onerror=record_walk_error,
    ):
        if directories_seen >= directory_limit:
            # 空目录也会消耗遍历时间，因此同时限制目录数并向 UI 报告截断。
            has_more = True
            break
        directories_seen += 1
        current = Path(current_name)
        dirnames[:] = sorted(name for name in dirnames if name.casefold() not in excluded_dirs and not _is_link_or_junction(current / name))
        for name in sorted(filenames):
            candidate = current / name
            if _is_link_or_junction(candidate):
                continue
            try:
                info = os.lstat(candidate)
                if not stat.S_ISREG(info.st_mode):
                    continue
                relative_name = candidate.relative_to(root).as_posix()
                parts = relative_name.split("/")
                if not relative_name or any(part in {"", ".", ".."} for part in parts) or "\\" in relative_name:
                    failures += 1
                    continue
            except OSError:
                failures += 1
                continue

            if len(files) >= limit:
                has_more = True
                break
            files.append(
                {
                    "name": relative_name,
                    "size_bytes": info.st_size,
                    "modified": info.st_mtime,
                }
            )
        if has_more:
            break

    return files, has_more, failures, directories_seen


def _modified_timestamp(value: Any) -> float | None:
    """Normalize storage timestamps for stable cross-source catalog ordering."""
    if isinstance(value, int | float) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        try:
            normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
            parsed = datetime.fromisoformat(normalized)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.timestamp()
        except ValueError:
            return None
    return None


def _read_confined_regular_file(directory: Path, name: str, max_bytes: int) -> bytes:
    """Open one simple filename under a resolved source directory safely."""
    if not name or Path(name).name != name or name in {".", ".."}:
        raise ValueError("Invalid file name")
    return _read_confined_path(directory, directory / name, max_bytes)


def _read_confined_workspace_file(directory: Path, name: str, max_bytes: int) -> bytes:
    """Read one relative workspace file without crossing links or generated areas."""
    parts = name.split("/") if isinstance(name, str) else []
    excluded_dirs = {entry.casefold() for entry in EXCLUDED_DIR_NAMES}
    if not parts or any(part in {"", ".", ".."} for part in parts) or "\\" in name or any(part.casefold() in excluded_dirs for part in parts[:-1]) or is_sensitive_workspace_path(name):
        raise ValueError("Invalid or sensitive workspace file path")

    root = directory.resolve(strict=True)
    candidate = root
    for part in parts[:-1]:
        candidate = candidate / part
        if _is_link_or_junction(candidate):
            raise ValueError("Workspace paths must not cross symbolic links or junctions")
    candidate = candidate / parts[-1]
    if _is_link_or_junction(candidate):
        raise ValueError("Symbolic links are not exportable")
    return _read_confined_path(root, candidate, max_bytes)


def _read_confined_path(root: Path, candidate: Path, max_bytes: int) -> bytes:
    """Open a regular file only when its resolved path remains under ``root``."""
    if max_bytes < 0:
        raise ValueError("max_bytes must not be negative")
    resolved_root = root.resolve(strict=True)
    if candidate.is_symlink():
        raise ValueError("Symbolic links are not exportable")
    resolved_file = candidate.resolve(strict=True)
    if not resolved_file.is_relative_to(resolved_root):
        raise ValueError("File is outside the owner's allowed storage root")

    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(candidate, flags)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
            raise ValueError("File is not a bounded regular file")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            content = stream.read(max_bytes + 1)
        if len(content) != info.st_size or len(content) > max_bytes:
            raise ValueError("File changed while it was being exported")
        return content
    finally:
        os.close(descriptor)
