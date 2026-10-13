"""可租约恢复的数据任务 worker；所有导出范围都保持显式且有界。"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import shutil
import stat
import tempfile
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from deerflow_extension_api import OwnerDataAuthorizationError, OwnerFile

from flow_desk_product_extension.data_job_authorization import required_data_job_scopes
from flow_desk_product_extension.settings import ProductSettingsStore

logger = logging.getLogger(__name__)

_ARTIFACT_TTL = timedelta(hours=24)
_MAX_EXPORT_BYTES = 10 * 1024 * 1024
_MAX_ACCOUNT_EXPORT_BYTES = 64 * 1024 * 1024
_ACCOUNT_MANIFEST_RESERVE_BYTES = 64 * 1024
_MAX_EXPORTED_THREADS = 5_000
_MAX_EXPORTED_RUNS = 50_000
_MAX_EXPORTED_PROJECTS = 5_000
_MAX_EXPORTED_SCHEDULED_TASKS = 5_000
_MAX_EXPORTED_AGENTS = 5_000
_MAX_EXPORTED_MEMORY_FACTS = 5_000
_MAX_EXPORTED_FILES = 5_000
_MAX_RAW_FILE_BYTES = 7 * 1024 * 1024
_THREAD_PAGE_SIZE = 100
_PROJECT_PAGE_SIZE = 100
_SCHEDULED_TASK_PAGE_SIZE = 100
_AGENT_PAGE_SIZE = 100
_FILE_PAGE_SIZE = 100
_MESSAGE_PAGE_SIZE = 50
_RUN_PAGE_SIZE = 100
_EXPORT_METADATA_RESERVE_BYTES = 4 * 1024
_LEASE_SECONDS = 300
_POLL_SECONDS = 0.75
_ARTIFACT_FILENAME_RE = re.compile(
    r"(?:\.[a-f0-9-]{36}\.json\.[a-f0-9-]{36}\.tmp|[a-f0-9-]{36}\.json)"
)


class _PermanentDataJobError(Exception):
    """不可通过重试修复的请求范围或数据格式错误。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _run_cursor_key(created_at: str, run_id: str) -> tuple[datetime, str]:
    """Normalize the Gateway's newest-first run cursor before checking progress."""
    if (
        not isinstance(created_at, str)
        or not created_at
        or not isinstance(run_id, str)
        or not run_id
    ):
        raise _PermanentDataJobError("invalid_reader_page")
    try:
        parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise _PermanentDataJobError("invalid_reader_page") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    else:
        parsed = parsed.astimezone(UTC)
    return parsed, run_id


class _CompositeExportStore:
    """让单范围导出器复用 owner/分页逻辑，同时只完成外层 ZIP 任务一次。"""

    def __init__(self, store: ProductSettingsStore, *, total_scopes: int) -> None:
        self._store = store
        self._total_scopes = total_scopes
        self.scope_index = 0
        self.completed_result: dict[str, Any] | None = None
        self.cancelled = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._store, name)

    async def update_data_job_progress(
        self,
        *,
        job_id: str,
        lease_token: str,
        progress: dict[str, Any],
        lease_seconds: int,
    ) -> bool:
        # 单范围导出器仍续租并检查取消；外层进度显示已完成的范围数，
        # 不把内层各自的分页计数混成一个无法解释的总进度。
        updated = await self._store.update_data_job_progress(
            job_id=job_id,
            lease_token=lease_token,
            progress={
                "stage": "inventory",
                "completed": self.scope_index,
                "total": self._total_scopes,
            },
            lease_seconds=lease_seconds,
        )
        self.cancelled = self.cancelled or not updated
        return updated

    async def complete_data_job(
        self,
        *,
        job_id: str,
        lease_token: str,
        result: dict[str, Any],
    ) -> bool:
        self.completed_result = result
        return True

    async def get_data_job(self, owner_user_id: str, job_id: str) -> dict[str, Any] | None:
        # 单范围 exporter 会在 complete 后确认终态。此处的完成只代表它已
        # 产出一个临时子包，最终持久化状态仍由 account exporter 统一提交。
        if self.completed_result is not None:
            return {"job_id": job_id, "owner_user_id": owner_user_id, "status": "completed"}
        return await self._store.get_data_job(owner_user_id, job_id)

    async def fail_data_job(self, **kwargs: Any) -> Any:
        if kwargs.get("error_code") == "cancelled_by_owner":
            self.cancelled = True
        return await self._store.fail_data_job(**kwargs)


class DataJobWorker:
    """按数据库租约领取任务；每个 Gateway 实例可同时运行一个 worker。

    中文说明：租约 token 是 fencing token。Gateway 重启或 worker 卡死后，旧执行者
    即使恢复也不能覆盖新执行者写入的进度或结果。偏好删除只操作 Flow Desk 自己的数据；
    threads、projects、scheduled_tasks、agents、memory 和 files 导出分别读取 Gateway
    明确提供的 owner-scoped capability，且非偏好导出始终标记为 partial。files 范围只打包
    宿主允许读取的有限用户文件；所有范围都排除凭据和可恢复 checkpoint，不能视为完整账号备份。
    """

    def __init__(
        self,
        store: ProductSettingsStore,
        artifact_directory: Path,
        *,
        owner_data_reader: Any | None = None,
        owner_data_deleter: Any | None = None,
        owner_data_authorizer: Any | None = None,
        worker_id: str | None = None,
    ) -> None:
        self._store = store
        self._artifact_directory = artifact_directory.resolve()
        self._owner_data_reader = owner_data_reader
        self._owner_data_deleter = owner_data_deleter
        self._owner_data_authorizer = owner_data_authorizer
        self._worker_id = worker_id or f"{os.getpid()}-{uuid4()}"
        self._task: asyncio.Task[None] | None = None
        self._stopping = asyncio.Event()
        self._next_cleanup = 0.0

    async def start(self) -> None:
        """启动后台轮询；重复启动不会创建重复 worker。"""
        if self._task is not None and not self._task.done():
            return
        await asyncio.to_thread(self._prepare_directory)
        self._stopping.clear()
        self._task = asyncio.create_task(self._serve(), name="flow-desk-data-job-worker")

    async def stop(self) -> None:
        """停止轮询；在途任务保留租约，超时后可由下一实例安全重试。"""
        task = self._task
        self._task = None
        if task is None:
            return
        self._stopping.set()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def run_once(self) -> bool:
        """领取并执行一个任务，供确定性测试和 worker 主循环共用。"""
        await asyncio.to_thread(self._prepare_directory)
        await self._cleanup_expired_artifacts()
        claim = await self._store.claim_data_job(
            worker_id=self._worker_id,
            lease_seconds=_LEASE_SECONDS,
        )
        if claim is None:
            return False
        try:
            # A queued job carries no permission snapshot. Reload route grants
            # and the active server-side IAM session immediately after claim.
            await self._reauthorize_claim(claim)
            if claim["kind"] == "export":
                if claim["scope"] == ["preferences"]:
                    await self._export_preferences(claim)
                elif claim["scope"] == ["account"]:
                    await self._export_account_bundle(claim)
                elif claim["scope"] == ["threads"]:
                    await self._export_threads(claim)
                elif claim["scope"] == ["projects"]:
                    await self._export_projects(claim)
                elif claim["scope"] == ["scheduled_tasks"]:
                    await self._export_scheduled_tasks(claim)
                elif claim["scope"] == ["agents"]:
                    await self._export_agents(claim)
                elif claim["scope"] == ["memory"]:
                    await self._export_memory(claim)
                elif claim["scope"] == ["files"]:
                    await self._export_files(claim)
                else:
                    raise _PermanentDataJobError("unsupported_scope")
            elif claim["kind"] == "deletion":
                if claim["scope"] == ["preferences"]:
                    await self._delete_preferences(claim)
                elif claim["scope"] == ["threads"]:
                    await self._delete_thread_history(claim)
                elif claim["scope"] == ["projects"]:
                    await self._delete_projects(claim)
                elif claim["scope"] == ["scheduled_tasks"]:
                    await self._delete_scheduled_task_definitions(claim)
                elif claim["scope"] == ["agents"]:
                    await self._delete_custom_agents(claim)
                elif claim["scope"] == ["memory"]:
                    await self._delete_memory(claim)
                elif claim["scope"] == ["files"]:
                    await self._delete_files(claim)
                else:
                    raise _PermanentDataJobError("unsupported_scope")
            else:
                raise _PermanentDataJobError("unsupported_job_kind")
        except _PermanentDataJobError as exc:
            await self._store.fail_data_job(
                job_id=claim["job_id"],
                lease_token=claim["lease_token"],
                error_code=exc.code,
                retry_after_seconds=None,
            )
        except OwnerDataAuthorizationError as exc:
            # A denied grant is terminal. A policy/vault outage is retryable,
            # but the worker never continues with its previous decision.
            denied = exc.status_code == 403
            await self._store.fail_data_job(
                job_id=claim["job_id"],
                lease_token=claim["lease_token"],
                error_code="authorization_revoked" if denied else "authorization_unavailable",
                retry_after_seconds=None if denied else 60,
            )
        except asyncio.CancelledError:
            # 不强行改成 cancelled；租约过期后其他实例将重新 claim 并恢复任务。
            raise
        except Exception:
            # 用户只看到稳定错误码；异常文本可能带宿主路径或数据内容，不写 API/审计。
            logger.exception("Flow Desk data job failed job_id=%s", claim["job_id"])
            await self._store.fail_data_job(
                job_id=claim["job_id"],
                lease_token=claim["lease_token"],
                error_code="temporary_storage_error",
                retry_after_seconds=30,
            )
        return True

    async def _export_preferences(self, claim: dict[str, Any]) -> None:
        job_id = claim["job_id"]
        lease_token = claim["lease_token"]
        owner_user_id = claim["owner_user_id"]
        await self._reauthorize_claim(claim)
        if not await self._store.update_data_job_progress(
            job_id=job_id,
            lease_token=lease_token,
            progress={"stage": "inventory", "completed": 0, "total": 1},
            lease_seconds=_LEASE_SECONDS,
        ):
            await self._settle_cancelled(claim)
            return

        preferences = await self._store.list_for_user(owner_user_id)
        document = {
            "format": "flow-desk-user-data-v1",
            "generated_at": datetime.now(UTC).isoformat(),
            "owner_user_id": owner_user_id,
            "scope": ["preferences"],
            "coverage_notes": [
                "This package contains Flow Desk product preferences only.",
                "It is not a full account export, backup, or LangGraph checkpoint package.",
            ],
            "resources": {"preferences": preferences},
        }
        try:
            payload = json.dumps(
                document,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise _PermanentDataJobError("invalid_export_data") from exc
        if len(payload) > _MAX_EXPORT_BYTES:
            raise _PermanentDataJobError("export_size_limit")

        if not await self._store.update_data_job_progress(
            job_id=job_id,
            lease_token=lease_token,
            progress={"stage": "packaging", "completed": 0, "total": 1},
            lease_seconds=_LEASE_SECONDS,
        ):
            await self._settle_cancelled(claim)
            return
        artifact_id = str(uuid4())
        target = self._artifact_directory / f"{artifact_id}.json"
        await asyncio.to_thread(self._write_atomic, target, payload)
        expiry = datetime.now(UTC) + _ARTIFACT_TTL
        completed = await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "artifact_id": artifact_id,
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "completeness": "complete",
                "expires_at": expiry.isoformat(),
            },
        )
        current = await self._store.get_data_job(owner_user_id, job_id)
        if not completed or current is None or current["status"] != "completed":
            await asyncio.to_thread(self._unlink_if_present, target)

    async def _export_account_bundle(self, claim: dict[str, Any]) -> None:
        """将现有 owner-scoped 导出合成一个明确标记为 partial 的 ZIP 包。"""
        scopes = (
            "preferences",
            "threads",
            "projects",
            "scheduled_tasks",
            "agents",
            "memory",
            "files",
        )
        exporters = {
            "preferences": "_export_preferences",
            "threads": "_export_threads",
            "projects": "_export_projects",
            "scheduled_tasks": "_export_scheduled_tasks",
            "agents": "_export_agents",
            "memory": "_export_memory",
            "files": "_export_files",
        }
        job_id = claim["job_id"]
        lease_token = claim["lease_token"]
        owner_user_id = claim["owner_user_id"]
        included: dict[str, Path] = {}
        scope_results: dict[str, dict[str, Any]] = {}
        raw_bytes = 0
        failed_resources = 0

        # 单范围 exporter 已各自实现 owner 检查、分页、限额与覆盖说明。
        # 这里隔离其临时文件并拦截“完成任务”，最终只提交一次 ZIP 制品。
        with tempfile.TemporaryDirectory(
            # 临时路径要短，Windows runner 的 repo/tmproot 可能接近传统路径长度限制。
            prefix=".ae-",
            dir=self._artifact_directory,
        ) as temporary_root:
            temporary_path = Path(temporary_root)
            for index, scope in enumerate(scopes):
                if not await self._update_progress_or_cancel(
                    claim,
                    {"stage": "inventory", "completed": index, "total": len(scopes)},
                ):
                    return

                scope_directory = temporary_path / scope
                scope_directory.mkdir()
                composite_store = _CompositeExportStore(
                    self._store,
                    total_scopes=len(scopes),
                )
                composite_store.scope_index = index
                scope_worker = DataJobWorker(
                    composite_store,  # type: ignore[arg-type]
                    scope_directory,
                    owner_data_reader=self._owner_data_reader,
                    owner_data_authorizer=self._owner_data_authorizer,
                    worker_id=self._worker_id,
                )
                await asyncio.to_thread(scope_worker._prepare_directory)
                scope_claim = {**claim, "scope": [scope]}
                try:
                    await getattr(scope_worker, exporters[scope])(scope_claim)
                except _PermanentDataJobError as exc:
                    scope_results[scope] = {
                        "status": "unavailable",
                        "error_code": exc.code,
                    }
                    failed_resources += 1
                    continue

                if composite_store.cancelled:
                    return
                result = composite_store.completed_result
                if result is None:
                    raise _PermanentDataJobError("scope_export_incomplete")
                artifact_id = result.get("artifact_id")
                if not isinstance(artifact_id, str) or not re.fullmatch(
                    r"[a-f0-9-]{36}", artifact_id
                ):
                    raise _PermanentDataJobError("invalid_scope_artifact")
                source = scope_directory / f"{artifact_id}.json"
                if not source.is_file() or source.is_symlink():
                    raise _PermanentDataJobError("invalid_scope_artifact")
                payload = await asyncio.to_thread(source.read_bytes)
                digest = hashlib.sha256(payload).hexdigest()
                if (
                    len(payload) != result.get("size_bytes")
                    or digest != result.get("sha256")
                    or len(payload) > _MAX_EXPORT_BYTES
                ):
                    raise _PermanentDataJobError("scope_artifact_integrity_error")
                if raw_bytes + len(payload) > (
                    _MAX_ACCOUNT_EXPORT_BYTES - _ACCOUNT_MANIFEST_RESERVE_BYTES
                ):
                    scope_results[scope] = {
                        "status": "omitted_size_limit",
                        "size_bytes": len(payload),
                    }
                    failed_resources += 1
                    continue

                included[scope] = source
                raw_bytes += len(payload)
                scope_failed = result.get("failed_resources_count", 0)
                if isinstance(scope_failed, int) and scope_failed > 0:
                    failed_resources += scope_failed
                scope_results[scope] = {
                    "status": "included",
                    "file": f"data/{scope}.json",
                    "size_bytes": len(payload),
                    "sha256": digest,
                    "completeness": result.get("completeness", "partial"),
                    "failed_resources_count": scope_failed if isinstance(scope_failed, int) else 0,
                }

            if not included:
                raise _PermanentDataJobError("no_export_scopes_available")
            manifest = {
                "format": "flow-desk-account-export-v1",
                "generated_at": datetime.now(UTC).isoformat(),
                "completeness": "partial",
                "requested_scopes": list(scopes),
                "included_scopes": [scope for scope in scopes if scope in included],
                "omitted_scopes": [scope for scope in scopes if scope not in included],
                "scopes": scope_results,
                "coverage_notes": [
                    "This bundle combines the supported owner-scoped exports; "
                    "it is not a full account backup.",
                    "Credentials, deployment configuration, LangGraph checkpoints, "
                    "and runtime continuation state are excluded.",
                    "Each scope retains its own coverage limits. Unavailable and "
                    "size-limited scopes are listed above.",
                ],
            }
            manifest_bytes = _compact_json_bytes(manifest)
            if raw_bytes + len(manifest_bytes) > _MAX_ACCOUNT_EXPORT_BYTES:
                raise _PermanentDataJobError("account_export_size_limit")

            archive = temporary_path / "account-export.zip"
            await asyncio.to_thread(
                self._build_account_archive,
                archive,
                included,
                manifest_bytes,
            )
            archive_size, archive_sha256 = await asyncio.to_thread(self._file_digest, archive)
            if archive_size > _MAX_ACCOUNT_EXPORT_BYTES:
                raise _PermanentDataJobError("account_export_size_limit")

            if not await self._update_progress_or_cancel(
                claim,
                {"stage": "packaging", "completed": 0, "total": 1},
            ):
                return
            artifact_id = str(uuid4())
            target = self._artifact_directory / f"{artifact_id}.json"
            await asyncio.to_thread(self._copy_atomic, archive, target)
            expiry = datetime.now(UTC) + _ARTIFACT_TTL
            completed = await self._store.complete_data_job(
                job_id=job_id,
                lease_token=lease_token,
                result={
                    "artifact_id": artifact_id,
                    "size_bytes": archive_size,
                    "sha256": archive_sha256,
                    "expires_at": expiry.isoformat(),
                    "completeness": "partial",
                    "failed_resources_count": failed_resources,
                },
            )
            current = await self._store.get_data_job(owner_user_id, job_id)
            if not completed or current is None or current["status"] != "completed":
                await asyncio.to_thread(self._unlink_if_present, target)

    @staticmethod
    def _build_account_archive(
        target: Path,
        included: dict[str, Path],
        manifest: bytes,
    ) -> None:
        """使用固定 ZIP 路径保存 manifest 和各 owner 范围 JSON。"""
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            zf.writestr("manifest.json", manifest)
            for scope, source in included.items():
                zf.write(source, arcname=f"data/{scope}.json")

    @staticmethod
    def _file_digest(path: Path) -> tuple[int, str]:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return path.stat().st_size, digest.hexdigest()

    @staticmethod
    def _copy_atomic(source: Path, target: Path) -> None:
        """原子发布 ZIP 制品，避免任务下载到半写入的归档。"""
        temporary = target.with_name(f".{target.name}.{uuid4()}.tmp")
        try:
            with source.open("rb") as incoming, temporary.open("xb") as outgoing:
                shutil.copyfileobj(incoming, outgoing)
                outgoing.flush()
                os.fsync(outgoing.fileno())
            try:
                os.chmod(temporary, stat.S_IRUSR | stat.S_IWUSR)
            except OSError:
                logger.debug("Could not apply POSIX permissions to an account export artifact")
            os.replace(temporary, target)
        finally:
            DataJobWorker._unlink_if_present(temporary)

    async def _export_threads(self, claim: dict[str, Any]) -> None:
        """导出会话、可见消息和安全运行摘要，不读取 checkpoint 表。"""
        reader = self._owner_data_reader
        if reader is None:
            raise _PermanentDataJobError("scope_unavailable")

        job_id = claim["job_id"]
        lease_token = claim["lease_token"]
        owner_user_id = claim["owner_user_id"]
        document: dict[str, Any] = {
            "format": "flow-desk-user-data-v1",
            "generated_at": datetime.now(UTC).isoformat(),
            "owner_user_id": owner_user_id,
            "scope": ["threads"],
            "completeness": "partial",
            "coverage_notes": [
                (
                    "Best-effort Gateway-visible thread summaries, message history and "
                    "run usage summaries."
                ),
                "It is not a full account export, backup, or LangGraph checkpoint package.",
                "Excludes files, Agents, Projects, memory, credentials and Flow Desk preferences.",
                (
                    "Run summaries omit request payloads, arbitrary metadata, error text, "
                    "stop reasons and worker lease details."
                ),
                "Paged reads are not a transaction snapshot; concurrent changes may be absent.",
            ],
            "resources": {"threads": []},
            "export_summary": {
                "thread_count": 0,
                "message_count": 0,
                "run_count": 0,
                "failed_resources_count": 0,
                "truncated": False,
            },
        }
        base_size = len(_compact_json_bytes(document))
        byte_budget = _MAX_EXPORT_BYTES - _EXPORT_METADATA_RESERVE_BYTES
        if base_size > byte_budget:
            raise _PermanentDataJobError("export_size_limit")

        # 第一阶段只收集有界的线程摘要。游标必须前进，防止损坏的 reader
        # 让后台任务无限循环并长期占有租约。
        threads: list[dict[str, Any]] = []
        offset = 0
        truncated = False
        while True:
            if not await self._update_progress_or_cancel(
                claim,
                {
                    "stage": "inventory",
                    "completed": len(threads),
                    "total": len(threads),
                },
            ):
                return
            page = await reader.list_threads(
                user_id=owner_user_id,
                limit=_THREAD_PAGE_SIZE,
                offset=offset,
            )
            for thread in page.threads:
                if len(threads) >= _MAX_EXPORTED_THREADS:
                    truncated = True
                    break
                if not isinstance(thread, dict):
                    document["export_summary"]["failed_resources_count"] += 1
                    continue
                threads.append(dict(thread))
            if truncated or not page.has_more:
                break
            next_offset = page.next_offset
            if not isinstance(next_offset, int) or next_offset <= offset:
                raise _PermanentDataJobError("invalid_reader_page")
            offset = next_offset

        exported: list[dict[str, Any]] = document["resources"]["threads"]
        size_used = base_size
        message_count = 0
        run_count = 0
        failed_resources = document["export_summary"]["failed_resources_count"]
        should_stop = truncated
        list_thread_runs = getattr(reader, "list_thread_runs", None)
        if not callable(list_thread_runs):
            # 旧宿主没有此可选 reader 时保留可读导出，但明确记录缺失范围。
            document["coverage_notes"].append(
                "This Gateway host does not expose owner-scoped run summaries."
            )

        # 第二阶段逐会话读取可见历史；每页续租并检查用户取消，避免大账号
        # 导出期间忽略取消信号。消息页使用稳定 sequence cursor 向更旧历史翻页。
        for thread_index, summary in enumerate(threads):
            if should_stop:
                break
            thread_id = summary.get("thread_id")
            if not isinstance(thread_id, str) or not thread_id:
                failed_resources += 1
                continue
            record = {"thread": summary, "messages": [], "runs": []}
            try:
                record_size = len(_compact_json_bytes(record))
            except (TypeError, ValueError):
                failed_resources += 1
                continue
            record_cost = record_size + (1 if exported else 0)
            if size_used + record_cost > byte_budget:
                truncated = True
                should_stop = True
                break
            exported.append(record)
            size_used += record_cost

            before_seq: int | None = None
            seen_cursors: set[int] = set()
            while True:
                if not await self._update_progress_or_cancel(
                    claim,
                    {
                        "stage": "history",
                        "completed": thread_index,
                        "total": len(threads),
                    },
                ):
                    return
                page = await reader.read_thread_messages_page(
                    user_id=owner_user_id,
                    thread_id=thread_id,
                    limit=_MESSAGE_PAGE_SIZE,
                    before_seq=before_seq,
                )
                if page is None:
                    # 线程在 inventory 和读取历史之间被删除/撤权，保留摘要并
                    # 把范围缺口写进 manifest，而不是伪装成完整历史。
                    failed_resources += 1
                    break

                for message in page.messages:
                    if not isinstance(message, dict):
                        failed_resources += 1
                        continue
                    try:
                        message_size = len(_compact_json_bytes(message))
                    except (TypeError, ValueError):
                        failed_resources += 1
                        continue
                    message_cost = message_size + (1 if record["messages"] else 0)
                    if size_used + message_cost > byte_budget:
                        truncated = True
                        should_stop = True
                        break
                    record["messages"].append(dict(message))
                    size_used += message_cost
                    message_count += 1

                if should_stop or not page.has_more:
                    break
                next_cursor = page.next_before_seq
                if (
                    not isinstance(next_cursor, int)
                    or next_cursor < 1
                    or next_cursor in seen_cursors
                    or (before_seq is not None and next_cursor >= before_seq)
                ):
                    raise _PermanentDataJobError("invalid_reader_page")
                seen_cursors.add(next_cursor)
                before_seq = next_cursor

            # 运行仓储与事件流是两份数据。只通过 Gateway 的 owner reader 读取
            # 白名单摘要，不把 request kwargs、异常正文或 checkpoint 导入产品扩展。
            if not should_stop and callable(list_thread_runs):
                before_created_at: str | None = None
                before_run_id: str | None = None
                seen_run_cursors: set[tuple[datetime, str]] = set()
                while True:
                    if not await self._update_progress_or_cancel(
                        claim,
                        {
                            "stage": "history",
                            "completed": thread_index,
                            "total": len(threads),
                        },
                    ):
                        return
                    try:
                        run_page = await list_thread_runs(
                            user_id=owner_user_id,
                            thread_id=thread_id,
                            limit=_RUN_PAGE_SIZE,
                            before_created_at=before_created_at,
                            before_run_id=before_run_id,
                        )
                    except (AttributeError, NotImplementedError):
                        document["coverage_notes"].append(
                            "This Gateway host does not expose owner-scoped run summaries."
                        )
                        break
                    if run_page is None:
                        failed_resources += 1
                        break

                    for run in run_page.runs:
                        if not isinstance(run, dict):
                            failed_resources += 1
                            continue
                        if run_count >= _MAX_EXPORTED_RUNS:
                            truncated = True
                            should_stop = True
                            break
                        try:
                            run_size = len(_compact_json_bytes(run))
                        except (TypeError, ValueError):
                            failed_resources += 1
                            continue
                        run_cost = run_size + (1 if record["runs"] else 0)
                        if size_used + run_cost > byte_budget:
                            truncated = True
                            should_stop = True
                            break
                        record["runs"].append(dict(run))
                        size_used += run_cost
                        run_count += 1

                    if should_stop or not run_page.has_more:
                        break
                    next_created_at = run_page.next_before_created_at
                    next_run_id = run_page.next_before_run_id
                    if (
                        not isinstance(next_created_at, str)
                        or not next_created_at
                        or not isinstance(next_run_id, str)
                        or not next_run_id
                    ):
                        raise _PermanentDataJobError("invalid_reader_page")
                    cursor = _run_cursor_key(next_created_at, next_run_id)
                    previous_cursor = (
                        _run_cursor_key(before_created_at, before_run_id)
                        if before_created_at is not None and before_run_id is not None
                        else None
                    )
                    if cursor in seen_run_cursors or (
                        previous_cursor is not None and cursor >= previous_cursor
                    ):
                        raise _PermanentDataJobError("invalid_reader_page")
                    seen_run_cursors.add(cursor)
                    # 公共 OwnerDataReader cursor 是 ISO 字符串；规范化后的
                    # datetime 只用于排序，不能把内部比较值泄漏到扩展契约。
                    before_created_at = cursor[0].isoformat()
                    before_run_id = cursor[1]

                if should_stop:
                    break

            if not should_stop and not await self._update_progress_or_cancel(
                claim,
                {
                    "stage": "history",
                    "completed": thread_index + 1,
                    "total": len(threads),
                },
            ):
                return

        if failed_resources:
            document["coverage_notes"].append(
                "Some thread resources were unavailable or could not be represented in JSON."
            )
        if truncated:
            document["coverage_notes"].append(
                "The export stopped at a configured thread-count or 10 MiB package limit."
            )
        document["export_summary"].update(
            {
                "thread_count": len(exported),
                "message_count": message_count,
                "run_count": run_count,
                "failed_resources_count": failed_resources,
                "truncated": truncated,
            }
        )
        payload = _compact_json_bytes(document)
        if len(payload) > _MAX_EXPORT_BYTES:
            # manifest 预留空间刻意设置得较宽；若后续扩充包内元数据，
            # 这道检查可避免元数据挤占用户数据的大小上限。
            raise _PermanentDataJobError("export_size_limit")

        if not await self._store.update_data_job_progress(
            job_id=job_id,
            lease_token=lease_token,
            progress={"stage": "packaging", "completed": 0, "total": 1},
            lease_seconds=_LEASE_SECONDS,
        ):
            await self._settle_cancelled(claim)
            return
        artifact_id = str(uuid4())
        target = self._artifact_directory / f"{artifact_id}.json"
        await asyncio.to_thread(self._write_atomic, target, payload)
        expiry = datetime.now(UTC) + _ARTIFACT_TTL
        completed = await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "artifact_id": artifact_id,
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "completeness": "partial",
                "failed_resources_count": failed_resources,
                "expires_at": expiry.isoformat(),
            },
        )
        current = await self._store.get_data_job(owner_user_id, job_id)
        if not completed or current is None or current["status"] != "completed":
            await asyncio.to_thread(self._unlink_if_present, target)

    async def _export_projects(self, claim: dict[str, Any]) -> None:
        """导出 Gateway owner-reader 提供的项目元数据，不读取项目文件内容。"""
        reader = self._owner_data_reader
        if reader is None:
            raise _PermanentDataJobError("scope_unavailable")

        job_id = claim["job_id"]
        lease_token = claim["lease_token"]
        owner_user_id = claim["owner_user_id"]
        document: dict[str, Any] = {
            "format": "flow-desk-user-data-v1",
            "generated_at": datetime.now(UTC).isoformat(),
            "owner_user_id": owner_user_id,
            "scope": ["projects"],
            "completeness": "partial",
            "coverage_notes": [
                "Contains owned project metadata: name, instructions, presentation, status "
                "and timestamps.",
                "Excludes project document contents, conversation history, uploads, generated "
                "files, credentials and checkpoints.",
                "Paged inventory is not a transaction snapshot; concurrent project changes "
                "may be absent.",
            ],
            "resources": {"projects": []},
            "export_summary": {
                "project_count": 0,
                "failed_resources_count": 0,
                "truncated": False,
            },
        }
        base_size = len(_compact_json_bytes(document))
        byte_budget = _MAX_EXPORT_BYTES - _EXPORT_METADATA_RESERVE_BYTES
        if base_size > byte_budget:
            raise _PermanentDataJobError("export_size_limit")

        projects: list[dict[str, Any]] = document["resources"]["projects"]
        size_used = base_size
        failed_resources = 0
        offset = 0
        truncated = False
        while True:
            if not await self._update_progress_or_cancel(
                claim,
                {
                    "stage": "inventory",
                    "completed": len(projects),
                    "total": len(projects),
                },
            ):
                return
            page = await reader.list_projects(
                user_id=owner_user_id,
                limit=_PROJECT_PAGE_SIZE,
                offset=offset,
            )
            if page is None:
                raise _PermanentDataJobError("scope_unavailable")

            for project in page.projects:
                if len(projects) >= _MAX_EXPORTED_PROJECTS:
                    truncated = True
                    break
                if (
                    not isinstance(project, dict)
                    or not isinstance(project.get("id"), str)
                    or not project["id"]
                ):
                    failed_resources += 1
                    continue
                try:
                    encoded_size = len(_compact_json_bytes(project))
                except (TypeError, ValueError):
                    failed_resources += 1
                    continue
                size_cost = encoded_size + (1 if projects else 0)
                if size_used + size_cost > byte_budget:
                    truncated = True
                    break
                projects.append(dict(project))
                size_used += size_cost

            if truncated or not page.has_more:
                break
            next_offset = page.next_offset
            if not isinstance(next_offset, int) or next_offset <= offset:
                raise _PermanentDataJobError("invalid_reader_page")
            offset = next_offset

        if failed_resources:
            document["coverage_notes"].append(
                "Some project metadata could not be represented in JSON."
            )
        if truncated:
            document["coverage_notes"].append(
                "The export stopped at the configured project-count or 10 MiB package limit."
            )
        document["export_summary"].update(
            {
                "project_count": len(projects),
                "failed_resources_count": failed_resources,
                "truncated": truncated,
            }
        )
        payload = _compact_json_bytes(document)
        if len(payload) > _MAX_EXPORT_BYTES:
            raise _PermanentDataJobError("export_size_limit")

        if not await self._store.update_data_job_progress(
            job_id=job_id,
            lease_token=lease_token,
            progress={"stage": "packaging", "completed": 0, "total": 1},
            lease_seconds=_LEASE_SECONDS,
        ):
            await self._settle_cancelled(claim)
            return
        artifact_id = str(uuid4())
        target = self._artifact_directory / f"{artifact_id}.json"
        await asyncio.to_thread(self._write_atomic, target, payload)
        expiry = datetime.now(UTC) + _ARTIFACT_TTL
        completed = await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "artifact_id": artifact_id,
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "completeness": "partial",
                "failed_resources_count": failed_resources,
                "expires_at": expiry.isoformat(),
            },
        )
        current = await self._store.get_data_job(owner_user_id, job_id)
        if not completed or current is None or current["status"] != "completed":
            await asyncio.to_thread(self._unlink_if_present, target)

    async def _export_scheduled_tasks(self, claim: dict[str, Any]) -> None:
        """导出 Gateway owner-reader 提供的计划定义，不包含执行历史。"""
        reader = self._owner_data_reader
        if reader is None:
            raise _PermanentDataJobError("scope_unavailable")

        job_id = claim["job_id"]
        lease_token = claim["lease_token"]
        owner_user_id = claim["owner_user_id"]
        coverage_notes = [
            "Contains owned schedule definitions: title, prompt, assistant and cadence.",
            "Excludes run history, run IDs, runtime errors, leases, credentials and checkpoints.",
            "Paged inventory is not a transaction snapshot; concurrent task changes may be absent.",
        ]
        document: dict[str, Any] = {
            "format": "flow-desk-user-data-v1",
            "generated_at": datetime.now(UTC).isoformat(),
            "owner_user_id": owner_user_id,
            "scope": ["scheduled_tasks"],
            "completeness": "partial",
            "coverage_notes": coverage_notes,
            "resources": {"scheduled_tasks": []},
            "export_summary": {
                "scheduled_task_count": 0,
                "failed_resources_count": 0,
                "truncated": False,
            },
        }
        byte_budget = _MAX_EXPORT_BYTES - _EXPORT_METADATA_RESERVE_BYTES
        size_used = len(_compact_json_bytes(document))
        if size_used > byte_budget:
            raise _PermanentDataJobError("export_size_limit")

        tasks: list[dict[str, Any]] = document["resources"]["scheduled_tasks"]
        failed_resources = 0
        offset = 0
        truncated = False
        while True:
            if not await self._update_progress_or_cancel(
                claim,
                {"stage": "inventory", "completed": len(tasks), "total": len(tasks)},
            ):
                return
            page = await reader.list_scheduled_tasks(
                user_id=owner_user_id,
                limit=_SCHEDULED_TASK_PAGE_SIZE,
                offset=offset,
            )
            if page is None:
                raise _PermanentDataJobError("scope_unavailable")

            for task in page.tasks:
                if len(tasks) >= _MAX_EXPORTED_SCHEDULED_TASKS:
                    truncated = True
                    break
                if (
                    not isinstance(task, dict)
                    or not isinstance(task.get("id"), str)
                    or not task["id"]
                ):
                    failed_resources += 1
                    continue
                try:
                    encoded_size = len(_compact_json_bytes(task))
                except (TypeError, ValueError):
                    failed_resources += 1
                    continue
                size_cost = encoded_size + (1 if tasks else 0)
                if size_used + size_cost > byte_budget:
                    truncated = True
                    break
                tasks.append(dict(task))
                size_used += size_cost

            if truncated or not page.has_more:
                break
            next_offset = page.next_offset
            if not isinstance(next_offset, int) or next_offset <= offset:
                raise _PermanentDataJobError("invalid_reader_page")
            offset = next_offset

        if failed_resources:
            coverage_notes.append(
                "Some scheduled task definitions could not be represented in JSON."
            )
        if truncated:
            coverage_notes.append(
                "The export stopped at the configured task-count or 10 MiB package limit."
            )
        summary = {
            "scheduled_task_count": len(tasks),
            "failed_resources_count": failed_resources,
            "truncated": truncated,
        }
        document["export_summary"].update(summary)
        payload = _compact_json_bytes(document)
        if len(payload) > _MAX_EXPORT_BYTES:
            raise _PermanentDataJobError("export_size_limit")

        if not await self._store.update_data_job_progress(
            job_id=job_id,
            lease_token=lease_token,
            progress={"stage": "packaging", "completed": 0, "total": 1},
            lease_seconds=_LEASE_SECONDS,
        ):
            await self._settle_cancelled(claim)
            return
        artifact_id = str(uuid4())
        target = self._artifact_directory / f"{artifact_id}.json"
        await asyncio.to_thread(self._write_atomic, target, payload)
        completed = await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "artifact_id": artifact_id,
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "expires_at": (datetime.now(UTC) + _ARTIFACT_TTL).isoformat(),
                "completeness": "partial",
                "failed_resources_count": failed_resources,
                "deleted_resources_count": 0,
            },
        )
        current = await self._store.get_data_job(owner_user_id, job_id)
        if not completed or current is None or current["status"] != "completed":
            await asyncio.to_thread(self._unlink_if_present, target)

    async def _export_agents(self, claim: dict[str, Any]) -> None:
        """导出 owner 自建 Agent 定义，排除部署级 GitHub 绑定及运行凭据。"""
        reader = self._owner_data_reader
        if reader is None:
            raise _PermanentDataJobError("scope_unavailable")

        job_id = claim["job_id"]
        lease_token = claim["lease_token"]
        owner_user_id = claim["owner_user_id"]
        coverage_notes = [
            "Contains custom Agents created by this account: settings and SOUL text.",
            (
                "Excludes deployment-wide shared Agents, GitHub bindings, credentials, "
                "skill contents, memory data and checkpoints."
            ),
            "Paged reads are not a transaction snapshot; concurrent Agent changes may be absent.",
        ]
        document: dict[str, Any] = {
            "format": "flow-desk-user-data-v1",
            "generated_at": datetime.now(UTC).isoformat(),
            "owner_user_id": owner_user_id,
            "scope": ["agents"],
            "completeness": "partial",
            "coverage_notes": coverage_notes,
            "resources": {"agents": []},
            "export_summary": {
                "agent_count": 0,
                "failed_resources_count": 0,
                "truncated": False,
            },
        }
        byte_budget = _MAX_EXPORT_BYTES - _EXPORT_METADATA_RESERVE_BYTES
        size_used = len(_compact_json_bytes(document))
        if size_used > byte_budget:
            raise _PermanentDataJobError("export_size_limit")

        # 只二次接纳可移交字段；即使 Gateway reader 日后扩展响应，也不会
        # 把 GitHub 的部署绑定或新的内部字段悄悄装入个人导出包。
        allowed_fields = {
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
            "soul",
        }
        agents: list[dict[str, Any]] = document["resources"]["agents"]
        offset = 0
        failed_resources = 0
        truncated = False
        while True:
            if not await self._update_progress_or_cancel(
                claim,
                {"stage": "inventory", "completed": len(agents), "total": len(agents)},
            ):
                return
            page = await reader.list_agents(
                user_id=owner_user_id,
                limit=_AGENT_PAGE_SIZE,
                offset=offset,
            )
            if page is None:
                raise _PermanentDataJobError("scope_unavailable")

            for source in page.agents:
                if len(agents) >= _MAX_EXPORTED_AGENTS:
                    truncated = True
                    break
                if (
                    not isinstance(source, dict)
                    or not isinstance(source.get("name"), str)
                    or not source["name"]
                ):
                    failed_resources += 1
                    continue
                portable_agent = {
                    key: value for key, value in source.items() if key in allowed_fields
                }
                try:
                    encoded_size = len(_compact_json_bytes(portable_agent))
                except (TypeError, ValueError):
                    failed_resources += 1
                    continue
                size_cost = encoded_size + (1 if agents else 0)
                if size_used + size_cost > byte_budget:
                    truncated = True
                    break
                agents.append(portable_agent)
                size_used += size_cost

            if truncated or not page.has_more:
                break
            next_offset = page.next_offset
            if not isinstance(next_offset, int) or next_offset <= offset:
                raise _PermanentDataJobError("invalid_reader_page")
            offset = next_offset

        if failed_resources:
            coverage_notes.append("Some Agent definitions could not be represented in JSON.")
        if truncated:
            coverage_notes.append(
                "The export stopped at the configured Agent-count or 10 MiB package limit."
            )
        document["export_summary"].update(
            {
                "agent_count": len(agents),
                "failed_resources_count": failed_resources,
                "truncated": truncated,
            }
        )
        payload = _compact_json_bytes(document)
        if len(payload) > _MAX_EXPORT_BYTES:
            raise _PermanentDataJobError("export_size_limit")

        if not await self._store.update_data_job_progress(
            job_id=job_id,
            lease_token=lease_token,
            progress={"stage": "packaging", "completed": 0, "total": 1},
            lease_seconds=_LEASE_SECONDS,
        ):
            await self._settle_cancelled(claim)
            return
        artifact_id = str(uuid4())
        target = self._artifact_directory / f"{artifact_id}.json"
        await asyncio.to_thread(self._write_atomic, target, payload)
        completed = await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "artifact_id": artifact_id,
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "expires_at": (datetime.now(UTC) + _ARTIFACT_TTL).isoformat(),
                "completeness": "partial",
                "failed_resources_count": failed_resources,
                "deleted_resources_count": 0,
            },
        )
        current = await self._store.get_data_job(owner_user_id, job_id)
        if not completed or current is None or current["status"] != "completed":
            await asyncio.to_thread(self._unlink_if_present, target)

    async def _export_memory(self, claim: dict[str, Any]) -> None:
        """导出当前用户的共享摘要与默认记忆事实，排除 Agent 专属记忆。"""
        reader = self._owner_data_reader
        if reader is None:
            raise _PermanentDataJobError("scope_unavailable")

        job_id = claim["job_id"]
        lease_token = claim["lease_token"]
        owner_user_id = claim["owner_user_id"]
        if not await self._update_progress_or_cancel(
            claim,
            {"stage": "inventory", "completed": 0, "total": 1},
        ):
            return

        source_memory = await reader.read_memory(user_id=owner_user_id)
        if source_memory is None:
            raise _PermanentDataJobError("scope_unavailable")
        if not isinstance(source_memory, dict):
            raise _PermanentDataJobError("invalid_export_data")

        # 即使宿主 Reader 扩大返回值，后台任务也只写入明确的可移交字段。
        memory: dict[str, Any] = {}
        for key in ("version", "lastUpdated"):
            if isinstance(source_memory.get(key), str):
                memory[key] = source_memory[key]
        summary_sections = {
            "user": ("workContext", "personalContext", "topOfMind"),
            "history": ("recentMonths", "earlierContext", "longTermBackground"),
        }
        for group, section_names in summary_sections.items():
            source_group = source_memory.get(group)
            if not isinstance(source_group, dict):
                continue
            safe_group = {}
            for section_name in section_names:
                section = source_group.get(section_name)
                if isinstance(section, dict):
                    safe_group[section_name] = {
                        key: section[key]
                        for key in ("summary", "updatedAt")
                        if isinstance(section.get(key), str)
                    }
            if safe_group:
                memory[group] = safe_group

        memory["facts"] = []
        coverage_notes = [
            (
                "Exports the configured memory backend's owner-scoped get_memory view; local "
                "DeerMem exposes shared summaries and the default-agent bucket, while other "
                "backends may return a different owner-scoped view."
            ),
            (
                "Excludes credentials, provider-private fields, checkpoints and data outside "
                "that owner-scoped result."
            ),
            "This is a best-effort point-in-time read; concurrent memory changes may be absent.",
        ]
        document: dict[str, Any] = {
            "format": "flow-desk-user-data-v1",
            "generated_at": datetime.now(UTC).isoformat(),
            "owner_user_id": owner_user_id,
            "scope": ["memory"],
            "completeness": "partial",
            "coverage_notes": coverage_notes,
            "resources": {"memory": memory},
            "export_summary": {
                "fact_count": 0,
                "failed_resources_count": 0,
                "truncated": False,
            },
        }
        byte_budget = _MAX_EXPORT_BYTES - _EXPORT_METADATA_RESERVE_BYTES
        size_used = len(_compact_json_bytes(document))
        if size_used > byte_budget:
            raise _PermanentDataJobError("export_size_limit")

        facts = source_memory.get("facts")
        facts = facts if isinstance(facts, list) else []
        string_fields = {
            "id",
            "content",
            "category",
            "categoryExtension",
            "createdAt",
            "source",
            "sourceError",
            "status",
            "consolidatedAt",
        }
        list_fields = {"topics", "consolidatedFrom"}
        exported_facts: list[dict[str, Any]] = memory["facts"]
        failed_resources = 0
        truncated = False
        for source_fact in facts:
            if len(exported_facts) >= _MAX_EXPORTED_MEMORY_FACTS:
                truncated = True
                break
            if not isinstance(source_fact, dict):
                failed_resources += 1
                continue
            fact: dict[str, Any] = {}
            for key in string_fields:
                value = source_fact.get(key)
                if isinstance(value, str):
                    fact[key] = value
            confidence = source_fact.get("confidence")
            if (
                isinstance(confidence, (int, float))
                and not isinstance(confidence, bool)
                and 0 <= confidence <= 1
            ):
                fact["confidence"] = confidence
            for key in list_fields:
                value = source_fact.get(key)
                if isinstance(value, list) and all(isinstance(item, str) for item in value):
                    fact[key] = value
            if not isinstance(fact.get("id"), str) or not isinstance(fact.get("content"), str):
                failed_resources += 1
                continue
            try:
                encoded_size = len(_compact_json_bytes(fact))
            except (TypeError, ValueError):
                failed_resources += 1
                continue
            size_cost = encoded_size + (1 if exported_facts else 0)
            if size_used + size_cost > byte_budget:
                truncated = True
                break
            exported_facts.append(fact)
            size_used += size_cost

        if failed_resources:
            coverage_notes.append(
                "Some memory facts could not be represented in the portable JSON format."
            )
        if truncated:
            coverage_notes.append(
                "The export stopped at the configured memory-fact count or 10 MiB package limit."
            )
        document["export_summary"].update(
            {
                "fact_count": len(exported_facts),
                "failed_resources_count": failed_resources,
                "truncated": truncated,
            }
        )
        payload = _compact_json_bytes(document)
        if len(payload) > _MAX_EXPORT_BYTES:
            raise _PermanentDataJobError("export_size_limit")

        if not await self._store.update_data_job_progress(
            job_id=job_id,
            lease_token=lease_token,
            progress={"stage": "packaging", "completed": 0, "total": 1},
            lease_seconds=_LEASE_SECONDS,
        ):
            await self._settle_cancelled(claim)
            return
        artifact_id = str(uuid4())
        target = self._artifact_directory / f"{artifact_id}.json"
        await asyncio.to_thread(self._write_atomic, target, payload)
        completed = await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "artifact_id": artifact_id,
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "expires_at": (datetime.now(UTC) + _ARTIFACT_TTL).isoformat(),
                "completeness": "partial",
                "failed_resources_count": failed_resources,
                "deleted_resources_count": 0,
            },
        )
        current = await self._store.get_data_job(owner_user_id, job_id)
        if not completed or current is None or current["status"] != "completed":
            await asyncio.to_thread(self._unlink_if_present, target)

    async def _export_files(self, claim: dict[str, Any]) -> None:
        """导出 Gateway 明确提供的用户文件，不读取任意宿主路径。"""
        reader = self._owner_data_reader
        if reader is None:
            raise _PermanentDataJobError("scope_unavailable")

        job_id = claim["job_id"]
        lease_token = claim["lease_token"]
        owner_user_id = claim["owner_user_id"]
        if not await self._update_progress_or_cancel(
            claim,
            {"stage": "files", "completed": 0, "total": 0},
        ):
            return

        # Raw bytes are capped below the JSON package size because base64 adds
        # roughly one third and every record also carries owner-visible names.
        source_files = await reader.read_files(
            user_id=owner_user_id,
            max_files=_MAX_EXPORTED_FILES + 1,
            max_total_bytes=_MAX_RAW_FILE_BYTES,
        )
        if source_files is None:
            raise _PermanentDataJobError("scope_unavailable")
        if not isinstance(source_files.files, (list, tuple)):
            raise _PermanentDataJobError("invalid_export_data")

        coverage_notes = [
            (
                "Contains flat thread uploads, flat generated outputs, eligible thread workspace "
                "files, and active Project shelf original files exposed by the Gateway."
            ),
            (
                "Workspace files with credential-like paths and generated directories, "
                "symbolic links, and junctions are excluded; each scan stops at 200 directories "
                "per thread and 20,000 directories total."
            ),
            (
                "Workspace file contents are not scanned for secrets; review this partial export "
                "before sharing it."
            ),
            (
                "Excludes derived document previews, trashed documents, checkpoints, stored "
                "deployment credentials and deployment files."
            ),
            (
                "This is a best-effort point-in-time read; files changing during export may be "
                "omitted."
            ),
            "The export is partial and is not a full account backup or a restore package.",
        ]
        for note in source_files.coverage_notes:
            if isinstance(note, str) and note and note not in coverage_notes:
                coverage_notes.append(note[:500])

        document: dict[str, Any] = {
            "format": "flow-desk-user-data-v1",
            "generated_at": datetime.now(UTC).isoformat(),
            "owner_user_id": owner_user_id,
            "scope": ["files"],
            "completeness": "partial",
            "coverage_notes": coverage_notes,
            "resources": {"files": []},
            "export_summary": {
                "file_count": 0,
                "source_bytes": 0,
                "failed_resources_count": max(0, int(source_files.failed_count)),
                "truncated": bool(source_files.truncated),
            },
        }
        byte_budget = _MAX_EXPORT_BYTES - _EXPORT_METADATA_RESERVE_BYTES
        size_used = len(_compact_json_bytes(document))
        if size_used > byte_budget:
            raise _PermanentDataJobError("export_size_limit")

        files: list[dict[str, Any]] = document["resources"]["files"]
        failed_resources = document["export_summary"]["failed_resources_count"]
        source_bytes = 0
        truncated = bool(source_files.truncated)
        allowed_sources = {"thread_upload", "thread_output", "thread_workspace", "project_document"}
        for index, source_file in enumerate(source_files.files):
            if index >= _MAX_EXPORTED_FILES:
                truncated = True
                break
            if not isinstance(source_file, OwnerFile):
                failed_resources += 1
                continue
            is_workspace_file = source_file.source == "thread_workspace"
            name_parts = source_file.name.split("/") if isinstance(source_file.name, str) else []
            # workspace 名称必须是跨平台的相对 POSIX 路径；拒绝盘符和 `..`，防止宿主路径被打进包。
            valid_name = (
                isinstance(source_file.name, str)
                and bool(source_file.name)
                and "\x00" not in source_file.name
                and (
                    (
                        is_workspace_file
                        and not source_file.name.startswith("/")
                        and "\\" not in source_file.name
                        and ":" not in source_file.name
                        and all(part not in {"", ".", ".."} for part in name_parts)
                    )
                    or (
                        not is_workspace_file
                        and source_file.name not in {".", ".."}
                        and "/" not in source_file.name
                        and "\\" not in source_file.name
                    )
                )
            )
            if not all(
                (
                    isinstance(source_file.source, str) and source_file.source in allowed_sources,
                    valid_name,
                    not is_workspace_file
                    or (isinstance(source_file.thread_id, str) and bool(source_file.thread_id)),
                    isinstance(source_file.size_bytes, int)
                    and not isinstance(source_file.size_bytes, bool)
                    and source_file.size_bytes >= 0,
                    isinstance(source_file.content, bytes),
                    len(source_file.content) == source_file.size_bytes,
                )
            ):
                failed_resources += 1
                continue
            record: dict[str, Any] = {
                "source": source_file.source,
                "name": source_file.name,
                "size_bytes": source_file.size_bytes,
                "sha256": hashlib.sha256(source_file.content).hexdigest(),
                "content_base64": base64.b64encode(source_file.content).decode("ascii"),
            }
            if isinstance(source_file.thread_id, str) and source_file.thread_id:
                record["thread_id"] = source_file.thread_id
            if isinstance(source_file.project_id, str) and source_file.project_id:
                record["project_id"] = source_file.project_id
            try:
                record_cost = len(_compact_json_bytes(record)) + (1 if files else 0)
            except (TypeError, ValueError):
                failed_resources += 1
                continue
            if size_used + record_cost > byte_budget:
                truncated = True
                break
            files.append(record)
            size_used += record_cost
            source_bytes += source_file.size_bytes

        if failed_resources:
            coverage_notes.append(
                "Some file resources were unavailable or could not be represented in the "
                "portable JSON format."
            )
        if truncated:
            coverage_notes.append(
                "The export stopped at the configured file-count, source-byte, or 10 MiB "
                "package limit."
            )
        document["export_summary"].update(
            {
                "file_count": len(files),
                "source_bytes": source_bytes,
                "failed_resources_count": failed_resources,
                "truncated": truncated,
            }
        )
        payload = _compact_json_bytes(document)
        if len(payload) > _MAX_EXPORT_BYTES:
            raise _PermanentDataJobError("export_size_limit")

        if not await self._store.update_data_job_progress(
            job_id=job_id,
            lease_token=lease_token,
            progress={"stage": "packaging", "completed": len(files), "total": len(files)},
            lease_seconds=_LEASE_SECONDS,
        ):
            await self._settle_cancelled(claim)
            return
        artifact_id = str(uuid4())
        target = self._artifact_directory / f"{artifact_id}.json"
        await asyncio.to_thread(self._write_atomic, target, payload)
        completed = await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "artifact_id": artifact_id,
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "expires_at": (datetime.now(UTC) + _ARTIFACT_TTL).isoformat(),
                "completeness": "partial",
                "failed_resources_count": failed_resources,
                "deleted_resources_count": 0,
            },
        )
        current = await self._store.get_data_job(owner_user_id, job_id)
        if not completed or current is None or current["status"] != "completed":
            await asyncio.to_thread(self._unlink_if_present, target)

    async def _update_progress_or_cancel(
        self,
        claim: dict[str, Any],
        progress: dict[str, int | str],
    ) -> bool:
        """续租并传播取消/栅栏结果；False 表示本任务不能继续读数据。"""
        await self._reauthorize_claim(claim)
        if await self._store.update_data_job_progress(
            job_id=claim["job_id"],
            lease_token=claim["lease_token"],
            progress=progress,
            lease_seconds=_LEASE_SECONDS,
        ):
            return True
        await self._settle_cancelled(claim)
        return False

    async def _reauthorize_claim(self, claim: dict[str, Any]) -> None:
        """Refresh authorization at claim and before each worker data boundary.

        Standalone worker unit tests may omit the host capability. The product
        service refuses to start without it whenever background jobs are enabled.
        """
        authorizer = self._owner_data_authorizer
        if authorizer is None:
            return
        authorize = getattr(authorizer, "authorize", None)
        scopes = required_data_job_scopes(claim["kind"], claim["scope"][0])
        if not callable(authorize) or not scopes:
            raise OwnerDataAuthorizationError(
                503,
                "Owner-data authorization is unavailable",
            )
        try:
            await authorize(user_id=claim["owner_user_id"], scopes=scopes)
        except asyncio.CancelledError:
            raise
        except OwnerDataAuthorizationError:
            raise
        except Exception:
            # Never put provider errors, credentials, or local paths into job rows.
            raise OwnerDataAuthorizationError(
                503,
                "Owner-data authorization is unavailable",
            ) from None

    async def _delete_preferences(self, claim: dict[str, Any]) -> None:
        # 偏好删除和任务完成放在同一个数据库事务里，避免报告成功却只删了一部分。
        await self._reauthorize_claim(claim)
        deleted = await self._store.delete_user_preferences_for_job(
            owner_user_id=claim["owner_user_id"],
            job_id=claim["job_id"],
            lease_token=claim["lease_token"],
        )
        if deleted is None:
            # 取消请求会在同一租约下安全终结为 cancelled；过期租约则会被 fencing。
            await self._store.fail_data_job(
                job_id=claim["job_id"],
                lease_token=claim["lease_token"],
                error_code="cancelled_by_owner",
                retry_after_seconds=None,
            )

    async def _delete_memory(self, claim: dict[str, Any]) -> None:
        """清空当前 owner 的记忆 bucket，不触碰其他产品或 Gateway 数据。"""
        deleter = self._owner_data_deleter
        delete_memory = getattr(deleter, "delete_memory", None)
        if not callable(delete_memory):
            raise _PermanentDataJobError("scope_unavailable")

        if not await self._update_progress_or_cancel(
            claim,
            {"stage": "deleting", "completed": 0, "total": 1},
        ):
            return

        # Gateway 再次使用服务端 owner 调用配置的 memory manager。该操作不可回滚；
        # 一旦进入 capability，就算用户同时点取消，也要记录清理确已完成。
        outcome = await delete_memory(user_id=claim["owner_user_id"])
        if outcome is None:
            raise _PermanentDataJobError("scope_unavailable")
        if outcome != "deleted":
            raise _PermanentDataJobError("invalid_deleter_result")

        await self._store.complete_data_job(
            job_id=claim["job_id"],
            lease_token=claim["lease_token"],
            result={
                "completeness": "complete",
                "deleted_resources_count": 1,
                "failed_resources_count": 0,
                "remaining_resources_count": 0,
            },
            finish_committed_deletion=True,
        )

    async def _delete_files(self, claim: dict[str, Any]) -> None:
        """删除本人上传文件，并将项目资料移入可恢复的回收站。

        Gateway 暂无安全的后台 API 清理生成输出和工作区文件；这些条目保留，
        任务会报告部分完成，不能将“文件”范围伪装成全量擦除。
        """
        reader = self._owner_data_reader
        deleter = self._owner_data_deleter
        list_files = getattr(reader, "list_files", None)
        delete_file = getattr(deleter, "delete_file", None)
        if (
            not callable(list_files)
            or getattr(deleter, "supports_file_delete", False) is not True
            or not callable(delete_file)
        ):
            raise _PermanentDataJobError("scope_unavailable")

        owner_user_id = claim["owner_user_id"]
        job_id = claim["job_id"]
        lease_token = claim["lease_token"]
        source_prefix = {
            "thread_upload": "thread_upload:",
            "thread_output": "thread_output:",
            "thread_workspace": "thread_workspace:",
            "project_document": "project-document:",
        }

        async def collect_files(
            *, report_progress: bool
        ) -> tuple[list[tuple[str, str]], int, bool]:
            files: list[tuple[str, str]] = []
            seen: set[str] = set()
            failed = 0
            incomplete_coverage = False
            offset = 0
            while True:
                if report_progress and not await self._update_progress_or_cancel(
                    claim,
                    {"stage": "inventory", "completed": len(files), "total": len(files)},
                ):
                    return files, failed, True
                page = await list_files(
                    user_id=owner_user_id,
                    limit=_FILE_PAGE_SIZE,
                    offset=offset,
                    query="",
                )
                entries = getattr(page, "files", None) if page is not None else None
                if not isinstance(entries, (list, tuple)):
                    raise _PermanentDataJobError("scope_unavailable")
                page_failed = getattr(page, "failed_count", 0)
                if isinstance(page_failed, int) and not isinstance(page_failed, bool):
                    failed += max(0, page_failed)
                notes = getattr(page, "coverage_notes", ())
                if getattr(page, "truncated", False) or notes:
                    incomplete_coverage = True

                stop_for_limit = False
                for entry in entries:
                    if isinstance(entry, dict):
                        file_id = entry.get("file_id")
                        source = entry.get("source")
                    else:
                        file_id = getattr(entry, "file_id", None)
                        source = getattr(entry, "source", None)
                    prefix = source_prefix.get(source) if isinstance(source, str) else None
                    if (
                        not isinstance(file_id, str)
                        or not file_id
                        or len(file_id) > 8192
                        or prefix is None
                        or not file_id.startswith(prefix)
                    ):
                        failed += 1
                        continue
                    if file_id in seen:
                        failed += 1
                        continue
                    if len(files) >= _MAX_EXPORTED_FILES:
                        incomplete_coverage = True
                        stop_for_limit = True
                        break
                    seen.add(file_id)
                    files.append((file_id, source))

                has_more = bool(getattr(page, "has_more", False))
                if stop_for_limit or not has_more:
                    break
                next_offset = getattr(page, "next_offset", None)
                if not isinstance(next_offset, int) or next_offset <= offset:
                    raise _PermanentDataJobError("invalid_reader_page")
                offset = next_offset
            return files, failed, incomplete_coverage

        files, failed_resources, truncated = await collect_files(report_progress=True)
        blocked_count = 0
        for index, (file_id, _source) in enumerate(files, start=1):
            if not await self._update_progress_or_cancel(
                claim,
                {"stage": "deleting", "completed": index - 1, "total": len(files)},
            ):
                return
            try:
                outcome = await delete_file(user_id=owner_user_id, file_id=file_id)
            except Exception:
                # 单项失败不能阻断其余 owner 文件；原始异常只保留在服务端诊断日志。
                logger.exception("Owner file deletion failed (job_id=%s)", job_id)
                outcome = "failed"
            if outcome in {"deleted", "trashed", "not_found"}:
                try:
                    await self._store.invalidate_owner_file_catalog_entry(
                        owner_user_id,
                        file_id,
                    )
                except Exception:
                    logger.exception("Owner file catalog invalidation failed (job_id=%s)", job_id)
                    blocked_count += 1
            else:
                blocked_count += 1
            if not await self._update_progress_or_cancel(
                claim,
                {"stage": "deleting", "completed": index, "total": len(files)},
            ):
                return

        await self._reauthorize_claim(claim)
        remaining_files, remaining_failures, remaining_truncated = await collect_files(
            report_progress=False
        )
        failed_resources = max(failed_resources, remaining_failures)
        truncated = truncated or remaining_truncated
        deleted_count = len(
            {file_id for file_id, _ in files}.difference(file_id for file_id, _ in remaining_files)
        )
        incomplete = bool(failed_resources or blocked_count or remaining_files or truncated)
        await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "completeness": "partial" if incomplete else "complete",
                "deleted_resources_count": deleted_count,
                "failed_resources_count": failed_resources + blocked_count,
                "remaining_resources_count": len(remaining_files),
            },
        )

    async def _delete_thread_history(self, claim: dict[str, Any]) -> None:
        """Clear only the owner's conversation history through Gateway capability calls.

        中文说明：每条会话都会由 Gateway 重新校验 owner，并在 durable delete
        reservation 下清理工作区、checkpoint、事件和运行用量。运行中的会话保留，
        任务会以部分结果结束，用户可以在工作结束后再次提交。
        """
        reader = self._owner_data_reader
        deleter = self._owner_data_deleter
        list_threads = getattr(reader, "list_threads", None)
        delete_thread = getattr(deleter, "delete_thread", None)
        if not callable(list_threads) or not callable(delete_thread):
            raise _PermanentDataJobError("scope_unavailable")

        owner_user_id = claim["owner_user_id"]
        job_id = claim["job_id"]
        lease_token = claim["lease_token"]

        async def collect_thread_ids(*, report_progress: bool) -> tuple[list[str], int, bool]:
            thread_ids: list[str] = []
            seen: set[str] = set()
            failed = 0
            truncated = False
            offset = 0
            while True:
                if report_progress and not await self._update_progress_or_cancel(
                    claim,
                    {"stage": "inventory", "completed": len(thread_ids), "total": len(thread_ids)},
                ):
                    return thread_ids, failed, True
                page = await list_threads(
                    user_id=owner_user_id,
                    limit=_THREAD_PAGE_SIZE,
                    offset=offset,
                )
                if page is None or not isinstance(page.threads, (list, tuple)):
                    raise _PermanentDataJobError("scope_unavailable")
                for thread in page.threads:
                    thread_id = thread.get("thread_id") if isinstance(thread, dict) else None
                    if not isinstance(thread_id, str) or not thread_id or len(thread_id) > 255:
                        failed += 1
                        continue
                    if thread_id in seen:
                        failed += 1
                        continue
                    if len(thread_ids) >= _MAX_EXPORTED_THREADS:
                        truncated = True
                        break
                    seen.add(thread_id)
                    thread_ids.append(thread_id)
                if truncated or not page.has_more:
                    break
                next_offset = page.next_offset
                if not isinstance(next_offset, int) or next_offset <= offset:
                    raise _PermanentDataJobError("invalid_reader_page")
                offset = next_offset
            return thread_ids, failed, truncated

        thread_ids, failed_resources, truncated = await collect_thread_ids(report_progress=True)
        executing_count = 0
        for index, thread_id in enumerate(thread_ids, start=1):
            if not await self._update_progress_or_cancel(
                claim,
                {"stage": "deleting", "completed": index - 1, "total": len(thread_ids)},
            ):
                return
            outcome = await delete_thread(user_id=owner_user_id, thread_id=thread_id)
            if outcome == "executing":
                executing_count += 1
            elif outcome not in {"deleted", "not_found"}:
                failed_resources += 1
            if not await self._update_progress_or_cancel(
                claim,
                {"stage": "deleting", "completed": index, "total": len(thread_ids)},
            ):
                return

        await self._reauthorize_claim(claim)
        remaining_ids, remaining_failures, remaining_truncated = await collect_thread_ids(
            report_progress=False
        )
        failed_resources = max(failed_resources, remaining_failures)
        deleted_count = len(set(thread_ids).difference(remaining_ids))
        truncated = truncated or remaining_truncated
        incomplete = bool(failed_resources or executing_count or remaining_ids or truncated)
        await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "completeness": "partial" if incomplete else "complete",
                "deleted_resources_count": deleted_count,
                "failed_resources_count": failed_resources + executing_count,
                "remaining_resources_count": len(remaining_ids),
            },
        )

    async def _delete_projects(self, claim: dict[str, Any]) -> None:
        """Remove owner project spaces using the Gateway's Trash-aware transaction.

        中文说明：先完整收集 owner 清单，再逐项删除，避免偏移分页在列表缩短时
        跳项。Gateway 删除项目定义时会解除会话关联并把资料移入回收站；本任务
        不删除会话正文，也不清空回收站。worker 复查清单，以在租约重试后恢复计数。
        """
        reader = self._owner_data_reader
        deleter = self._owner_data_deleter
        list_projects = getattr(reader, "list_projects", None)
        delete_project = getattr(deleter, "delete_project", None)
        if (
            not callable(list_projects)
            or getattr(deleter, "supports_project_delete", False) is not True
            or not callable(delete_project)
        ):
            raise _PermanentDataJobError("scope_unavailable")

        owner_user_id = claim["owner_user_id"]
        job_id = claim["job_id"]
        lease_token = claim["lease_token"]

        async def collect_ids(*, report_progress: bool) -> tuple[list[str], int, bool]:
            project_ids: list[str] = []
            seen: set[str] = set()
            failed = 0
            truncated = False
            offset = 0
            while True:
                if report_progress and not await self._update_progress_or_cancel(
                    claim,
                    {
                        "stage": "inventory",
                        "completed": len(project_ids),
                        "total": len(project_ids),
                    },
                ):
                    return project_ids, failed, True
                page = await list_projects(
                    user_id=owner_user_id,
                    limit=_PROJECT_PAGE_SIZE,
                    offset=offset,
                )
                if page is None or not isinstance(page.projects, (list, tuple)):
                    raise _PermanentDataJobError("scope_unavailable")
                for project in page.projects:
                    project_id = project.get("id") if isinstance(project, dict) else None
                    if not isinstance(project_id, str) or not project_id or len(project_id) > 255:
                        failed += 1
                        continue
                    if project_id in seen:
                        failed += 1
                        continue
                    if len(project_ids) >= _MAX_EXPORTED_PROJECTS:
                        truncated = True
                        break
                    seen.add(project_id)
                    project_ids.append(project_id)
                if truncated or not page.has_more:
                    break
                next_offset = page.next_offset
                if not isinstance(next_offset, int) or next_offset <= offset:
                    raise _PermanentDataJobError("invalid_reader_page")
                offset = next_offset
            return project_ids, failed, truncated

        project_ids, failed_resources, truncated = await collect_ids(report_progress=True)
        blocked_count = 0
        for index, project_id in enumerate(project_ids, start=1):
            if not await self._update_progress_or_cancel(
                claim,
                {"stage": "deleting", "completed": index - 1, "total": len(project_ids)},
            ):
                return
            outcome = await delete_project(user_id=owner_user_id, project_id=project_id)
            if outcome not in {"deleted", "not_found"}:
                blocked_count += 1
            if not await self._update_progress_or_cancel(
                claim,
                {"stage": "deleting", "completed": index, "total": len(project_ids)},
            ):
                return

        await self._reauthorize_claim(claim)
        remaining_ids, remaining_failures, remaining_truncated = await collect_ids(
            report_progress=False
        )
        failed_resources = max(failed_resources, remaining_failures)
        deleted_count = len(set(project_ids).difference(remaining_ids))
        truncated = truncated or remaining_truncated
        incomplete = bool(failed_resources or blocked_count or remaining_ids or truncated)
        await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "completeness": "partial" if incomplete else "complete",
                "deleted_resources_count": deleted_count,
                "failed_resources_count": failed_resources + blocked_count,
                "remaining_resources_count": len(remaining_ids),
            },
        )

    async def _delete_scheduled_task_definitions(self, claim: dict[str, Any]) -> None:
        """移除 owner 的计划定义；宿主拒绝仍在执行的 occurrence。

        中文说明：这是分布式、可重试的数据任务，不会直接访问宿主数据库。
        Gateway 每次按 owner 校验并删除一条定义；任务运行历史和对应会话内容
        按当前宿主语义保留。取消任务只能停止后续删除，不能恢复此前已删定义。
        """
        reader = self._owner_data_reader
        deleter = self._owner_data_deleter
        list_tasks = getattr(reader, "list_scheduled_tasks", None)
        delete_task = getattr(deleter, "delete_scheduled_task", None)
        if not callable(list_tasks) or not callable(delete_task):
            raise _PermanentDataJobError("scope_unavailable")

        owner_user_id = claim["owner_user_id"]
        job_id = claim["job_id"]
        lease_token = claim["lease_token"]

        async def collect_ids(*, report_progress: bool) -> tuple[list[str], int, bool]:
            ids: list[str] = []
            seen: set[str] = set()
            failed = 0
            truncated = False
            offset = 0
            while True:
                if report_progress and not await self._update_progress_or_cancel(
                    claim,
                    {"stage": "inventory", "completed": len(ids), "total": len(ids)},
                ):
                    return ids, failed, True
                page = await list_tasks(
                    user_id=owner_user_id,
                    limit=_SCHEDULED_TASK_PAGE_SIZE,
                    offset=offset,
                )
                if page is None or not isinstance(page.tasks, (list, tuple)):
                    raise _PermanentDataJobError("scope_unavailable")
                for task in page.tasks:
                    task_id = task.get("id") if isinstance(task, dict) else None
                    if not isinstance(task_id, str) or not task_id:
                        failed += 1
                        continue
                    if task_id in seen:
                        failed += 1
                        continue
                    if len(ids) >= _MAX_EXPORTED_SCHEDULED_TASKS:
                        truncated = True
                        break
                    seen.add(task_id)
                    ids.append(task_id)
                if truncated or not page.has_more:
                    break
                next_offset = page.next_offset
                if not isinstance(next_offset, int) or next_offset <= offset:
                    raise _PermanentDataJobError("invalid_reader_page")
                offset = next_offset
            return ids, failed, truncated

        task_ids, failed_resources, truncated = await collect_ids(report_progress=True)
        if task_ids is None:  # pragma: no cover - tuple contract protects callers
            raise _PermanentDataJobError("invalid_reader_page")

        blocked_count = 0
        for index, task_id in enumerate(task_ids, start=1):
            if not await self._update_progress_or_cancel(
                claim,
                {
                    "stage": "deleting",
                    "completed": index - 1,
                    "total": len(task_ids),
                },
            ):
                return
            outcome = await delete_task(user_id=owner_user_id, task_id=task_id)
            if outcome == "executing":
                blocked_count += 1
            elif outcome not in {"deleted", "not_found"}:
                failed_resources += 1
            if not await self._update_progress_or_cancel(
                claim,
                {
                    "stage": "deleting",
                    "completed": index,
                    "total": len(task_ids),
                },
            ):
                return

        await self._reauthorize_claim(claim)
        remaining_ids, remaining_failures, remaining_truncated = await collect_ids(
            report_progress=False
        )
        failed_resources += remaining_failures
        remaining_count = len(remaining_ids)
        # 通过前后清单计算已消失的定义数；worker 若在删除提交后、任务完成前崩溃，
        # 重试时仓储会返回 not_found，但用户仍应看到此前已完成的删除数量。
        deleted_count = len(set(task_ids).difference(remaining_ids))
        truncated = truncated or remaining_truncated
        incomplete = bool(failed_resources or blocked_count or remaining_count or truncated)
        await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "completeness": "partial" if incomplete else "complete",
                "deleted_resources_count": deleted_count,
                "failed_resources_count": failed_resources,
                "remaining_resources_count": remaining_count,
            },
        )

    async def _delete_custom_agents(self, claim: dict[str, Any]) -> None:
        """删除本人自建 Agent 定义及其随定义保存的 SOUL/记忆文件。

        中文说明：通过 Gateway 的精确 owner reader 建清单，再逐项调用独立删除
        capability。共享 legacy Agent 与没有自建定义的记忆目录不在此范围内；
        删除不可回滚，worker 在提交后崩溃时会通过删除前后清单恢复已删数量。
        """
        reader = self._owner_data_reader
        deleter = self._owner_data_deleter
        list_agents = getattr(reader, "list_agents", None)
        delete_agent = getattr(deleter, "delete_agent", None)
        if not callable(list_agents) or not callable(delete_agent):
            raise _PermanentDataJobError("scope_unavailable")

        owner_user_id = claim["owner_user_id"]
        job_id = claim["job_id"]
        lease_token = claim["lease_token"]

        async def collect_names(*, report_progress: bool) -> tuple[list[str], int, bool]:
            names: list[str] = []
            seen: set[str] = set()
            failed = 0
            truncated = False
            offset = 0
            while True:
                if report_progress and not await self._update_progress_or_cancel(
                    claim,
                    {"stage": "inventory", "completed": len(names), "total": len(names)},
                ):
                    return names, failed, True
                page = await list_agents(
                    user_id=owner_user_id,
                    limit=_AGENT_PAGE_SIZE,
                    offset=offset,
                )
                if page is None or not isinstance(page.agents, (list, tuple)):
                    raise _PermanentDataJobError("scope_unavailable")
                for agent in page.agents:
                    name = agent.get("name") if isinstance(agent, dict) else None
                    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,64}", name):
                        failed += 1
                        continue
                    if name in seen:
                        failed += 1
                        continue
                    if len(names) >= _MAX_EXPORTED_AGENTS:
                        truncated = True
                        break
                    seen.add(name)
                    names.append(name)
                if truncated or not page.has_more:
                    break
                next_offset = page.next_offset
                if not isinstance(next_offset, int) or next_offset <= offset:
                    raise _PermanentDataJobError("invalid_reader_page")
                offset = next_offset
            return names, failed, truncated

        names, failed_resources, truncated = await collect_names(report_progress=True)
        blocked_count = 0
        for index, name in enumerate(names, start=1):
            if not await self._update_progress_or_cancel(
                claim,
                {"stage": "deleting", "completed": index - 1, "total": len(names)},
            ):
                return
            outcome = await delete_agent(user_id=owner_user_id, name=name)
            if outcome == "not_found":
                # 幂等重试：其他已授权路径可能在本任务重试间隙完成删除。
                pass
            elif outcome != "deleted":
                blocked_count += 1
            if not await self._update_progress_or_cancel(
                claim,
                {"stage": "deleting", "completed": index, "total": len(names)},
            ):
                return

        await self._reauthorize_claim(claim)
        remaining, remaining_failures, remaining_truncated = await collect_names(
            report_progress=False
        )
        # Reader 返回的无效 name 会同时出现在前后清单；一次任务里按资源计数，不重复累计。
        failed_resources = max(failed_resources, remaining_failures)
        deleted_count = len(set(names).difference(remaining))
        truncated = truncated or remaining_truncated
        incomplete = bool(failed_resources or blocked_count or remaining or truncated)
        await self._store.complete_data_job(
            job_id=job_id,
            lease_token=lease_token,
            result={
                "completeness": "partial" if incomplete else "complete",
                "deleted_resources_count": deleted_count,
                "failed_resources_count": failed_resources + blocked_count,
                "remaining_resources_count": len(remaining),
            },
        )

    async def _settle_cancelled(self, claim: dict[str, Any]) -> None:
        """收到取消或旧租约时尝试终结；过期 token 会由仓储层拒绝。"""
        await self._store.fail_data_job(
            job_id=claim["job_id"],
            lease_token=claim["lease_token"],
            error_code="cancelled_by_owner",
            retry_after_seconds=None,
        )

    async def _serve(self) -> None:
        while not self._stopping.is_set():
            try:
                found_work = await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Flow Desk data job worker poll failed")
                found_work = False
            if not found_work:
                try:
                    await asyncio.wait_for(self._stopping.wait(), timeout=_POLL_SECONDS)
                except TimeoutError:
                    pass

    async def _cleanup_expired_artifacts(self) -> None:
        loop = asyncio.get_running_loop()
        if loop.time() < self._next_cleanup:
            return
        self._next_cleanup = loop.time() + 60
        cutoff = datetime.now(UTC).timestamp() - _ARTIFACT_TTL.total_seconds()
        await asyncio.to_thread(self._delete_old_files, cutoff)

    def _prepare_directory(self) -> None:
        self._artifact_directory.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self._artifact_directory, stat.S_IRWXU)
        except OSError:
            # 文件访问权限由 Windows ACL 决定；部署说明要求此数据卷仅对
            # Gateway 服务账号开放，避免导出制品被其他本机账号读取。
            logger.debug("Could not apply POSIX permissions to the export directory")

    @staticmethod
    def _write_atomic(target: Path, payload: bytes) -> None:
        temporary = target.with_name(f".{target.name}.{uuid4()}.tmp")
        try:
            with temporary.open("xb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.chmod(temporary, stat.S_IRUSR | stat.S_IWUSR)
            except OSError:
                logger.debug("Could not apply POSIX permissions to an export artifact")
            os.replace(temporary, target)
        finally:
            DataJobWorker._unlink_if_present(temporary)

    @staticmethod
    def _unlink_if_present(path: Path) -> None:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.exception("Could not remove Flow Desk export artifact %s", path.name)

    def _delete_old_files(self, cutoff: float) -> None:
        if not self._artifact_directory.exists():
            return
        for path in self._artifact_directory.iterdir():
            if _ARTIFACT_FILENAME_RE.fullmatch(path.name) is None:
                continue
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink(missing_ok=True)
            except OSError:
                logger.exception("Could not prune an expired Flow Desk artifact %s", path.name)


def _compact_json_bytes(value: Any) -> bytes:
    """用与最终制品一致的紧凑格式计算 UTF-8 字节长度。"""
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
