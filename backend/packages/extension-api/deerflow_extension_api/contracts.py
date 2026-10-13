"""The extension contracts and their data types.

Compatibility rules enforced throughout this module:
  * every Protocol method carries a default implementation, so adding a method
    later stays additive for already-released extensions;
  * every optional dataclass field carries a default, so adding a field stays
    additive.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal, Protocol, TypeVar, runtime_checkable

from deerflow_extension_api.state import ExtensionData

if TYPE_CHECKING:  # pragma: no cover - typing only
    from deerflow_extension_api.assembly import AgentAssemblyObserver
    from deerflow_extension_api.compaction import ContextCompactionObserver
    from deerflow_extension_api.placement import AgentBuildContext, MiddlewarePlacement
    from deerflow_extension_api.run_evidence import RunEvidenceReader

F = TypeVar("F", bound=Callable[..., Any])


# --- Host projections -------------------------------------------------------


@dataclass(frozen=True)
class HostPolicySnapshot:
    """The limits the host actually enforces, projected for extensions.

    A narrow projection instead of the host's AppConfig: exposing AppConfig
    would pin every extension to the harness release cadence. Every field has
    a default so widening this stays additive.
    """

    token_budget_enabled: bool = False
    max_input_tokens: int | None = None
    max_output_tokens: int | None = None
    max_total_tokens: int | None = None
    budget_warn_fraction: float | None = None
    budget_hard_fraction: float | None = None
    max_subagents_per_run: int | None = None


# --- Task lifecycle ---------------------------------------------------------


class TaskOutcome(StrEnum):
    COMPLETED = "completed"
    ABORTED = "aborted"
    FAILED = "failed"


@dataclass(frozen=True)
class TaskInfo:
    """Identity of one lead-agent or subagent execution."""

    task_id: str
    run_id: str
    thread_id: str
    kind: Literal["lead", "subagent"]
    parent_task_id: str | None = None
    agent_name: str | None = None
    resumed: bool = False


class TaskLifecycleContributor(Protocol):
    async def on_task_start(
        self,
        app_store: ExtensionData,
        task_store: ExtensionData,
        info: TaskInfo,
    ) -> None:
        return None

    async def on_task_stop(
        self,
        app_store: ExtensionData,
        task_store: ExtensionData,
        info: TaskInfo,
        outcome: TaskOutcome,
    ) -> None:
        return None


# --- System model calls not wrapped by middleware model-call hooks ----------


class SystemOperationKind(StrEnum):
    GOAL = "goal"
    MEMORY = "memory"
    TITLE = "title"
    SUMMARIZATION = "summarization"


@dataclass(frozen=True)
class SystemModelRequest:
    """Read-only snapshot taken before a system-owned model call."""

    messages: Sequence[Any] = ()
    model_name: str | None = None
    invoke_config: Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        """Normalize ``messages`` to a tuple so the snapshot is what it claims to be.

        Call sites differ: goal evaluation and memory extraction pass a message list,
        while title generation and summarization pass one prompt string. A bare ``str``
        already satisfies ``Sequence``, so without this an observer iterating
        ``request.messages`` would silently walk characters. Copying a list also makes
        the frozen snapshot immutable in fact, not only by dataclass declaration — the
        caller keeps its own list and observations may run after the call returns.
        """
        messages = self.messages
        if isinstance(messages, tuple):
            return
        normalized = tuple(messages) if isinstance(messages, Sequence) and not isinstance(messages, str | bytes) else (messages,)
        object.__setattr__(self, "messages", normalized)


@dataclass(frozen=True)
class SystemModelResult:
    """Success or failure snapshot taken after a system-owned model call."""

    response: Any | None = None
    error: BaseException | None = None
    duration_ms: float | None = None


class SystemModelCallObserver(Protocol):
    async def on_system_model_call(
        self,
        app_store: ExtensionData,
        task_store: ExtensionData,
        kind: SystemOperationKind,
        request: SystemModelRequest,
        result: SystemModelResult,
    ) -> None:
        return None


# --- Gateway admin action audit -------------------------------------------


@dataclass(frozen=True)
class AdminActionEvent:
    """Bounded metadata for one completed host-managed action.

    The event intentionally carries stable identifiers and action codes only;
    callers must never put passwords, tokens, message bodies, or setting values
    into this contract. The ``AdminAction`` name is retained for compatibility;
    the Gateway also uses this contract for completed owner-scoped product actions.
    """

    actor_user_id: str
    action: str
    resource_type: str
    resource_id: str | None
    outcome: Literal["success", "failure", "not_found"]
    occurred_at: datetime
    request_id: str | None = None


class AdminActionObserver(Protocol):
    """Observe completed Gateway actions without importing Gateway internals.

    The public name and callback remain ``admin_action`` for compatibility with
    existing extensions, including product audit observers.
    """

    async def on_admin_action(self, event: AdminActionEvent) -> None:
        return None


# --- Owner-scoped account data reads --------------------------------------


@dataclass(frozen=True)
class OwnerDataScope:
    """One route grant and row scope needed by a background owner-data job."""

    target: str
    action: str
    resource_id: str | None = None


class OwnerDataAuthorizer(Protocol):
    """Refresh a user's current host authorization before owner-data access."""

    async def authorize(self, *, user_id: str, scopes: Sequence[OwnerDataScope]) -> None:
        return None


@dataclass(frozen=True)
class OwnerThreadPage:
    """A bounded page of explicitly-owned thread summaries."""

    threads: Sequence[Mapping[str, Any]] = ()
    has_more: bool = False
    next_offset: int | None = None


@dataclass(frozen=True)
class OwnerMessagePage:
    """A backward page of messages visible in the owner's thread history."""

    messages: Sequence[Mapping[str, Any]] = ()
    has_more: bool = False
    next_before_seq: int | None = None


@dataclass(frozen=True)
class OwnerRunPage:
    """一页已核对 owner 的运行摘要，不含错误正文、请求参数或内部 metadata。"""

    runs: Sequence[Mapping[str, Any]] = ()
    has_more: bool = False
    next_before_created_at: str | None = None
    next_before_run_id: str | None = None


@dataclass(frozen=True)
class OwnerProjectPage:
    """A bounded page of explicitly-owned project metadata."""

    projects: Sequence[Mapping[str, Any]] = ()
    has_more: bool = False
    next_offset: int | None = None


@dataclass(frozen=True)
class OwnerScheduledTaskPage:
    """A bounded page of explicitly-owned scheduled task definitions."""

    tasks: Sequence[Mapping[str, Any]] = ()
    has_more: bool = False
    next_offset: int | None = None


@dataclass(frozen=True)
class OwnerAgentPage:
    """A bounded page of an owner's portable custom-Agent definitions."""

    agents: Sequence[Mapping[str, Any]] = ()
    has_more: bool = False
    next_offset: int | None = None


@dataclass(frozen=True)
class OwnerFile:
    """One regular file's bytes from an explicitly-owned user storage area.

    Host paths are intentionally absent. ``source`` is a stable, low-detail
    category such as ``thread_upload`` or ``project_document``. A
    ``thread_workspace`` file uses a relative POSIX path in ``name``; other
    sources keep a single filename. The extension must never treat this name
    as a host path.
    """

    source: str
    name: str
    size_bytes: int
    content: bytes
    thread_id: str | None = None
    project_id: str | None = None


@dataclass(frozen=True)
class OwnerFiles:
    """Bounded file payloads plus explicit omissions from an owner read."""

    files: Sequence[OwnerFile] = ()
    truncated: bool = False
    failed_count: int = 0
    coverage_notes: Sequence[str] = ()


@dataclass(frozen=True)
class OwnerFileEntry:
    """Metadata for one owner's file; content and host filesystem paths stay private.

    ``artifact_url`` is a Gateway-relative URL whose endpoint applies the usual
    owner checks again when the browser opens or downloads the file.
    """

    file_id: str
    source: str
    name: str
    size_bytes: int
    artifact_url: str
    modified_at: float | None = None
    storage_name: str | None = None
    thread_id: str | None = None
    thread_name: str | None = None
    project_id: str | None = None
    project_name: str | None = None
    document_id: str | None = None


@dataclass(frozen=True)
class OwnerFilePage:
    """有界的 owner 文件目录页及扫描遗漏提示。

    ``total`` 只统计本次有界扫描得到的匹配项；若 ``truncated`` 为真，
    它不是账号完整文件总数，调用方应向用户显示覆盖范围不完整的提示。
    """

    files: Sequence[OwnerFileEntry] = ()
    total: int = 0
    has_more: bool = False
    next_offset: int | None = None
    truncated: bool = False
    failed_count: int = 0
    coverage_notes: Sequence[str] = ()


class OwnerDataReader(Protocol):
    """Narrow, read-only host capability for trusted product data jobs.

    Every call requires an explicit owner ID. The host must enforce that ID at
    every resource storage boundary; ``None`` must never mean "all owners" on
    this contract. Project listings contain metadata only; ``read_files`` is
    the separately bounded capability for that owner's supported file bytes.
    """

    async def list_threads(
        self,
        *,
        user_id: str,
        limit: int,
        offset: int,
    ) -> OwnerThreadPage:
        return OwnerThreadPage()

    async def list_projects(
        self,
        *,
        user_id: str,
        limit: int,
        offset: int,
    ) -> OwnerProjectPage | None:
        """Return a bounded owner page, or ``None`` when project storage is unavailable."""
        return None

    async def list_scheduled_tasks(
        self,
        *,
        user_id: str,
        limit: int,
        offset: int,
    ) -> OwnerScheduledTaskPage | None:
        """Return owned task definitions without run history or lease internals."""
        return None

    async def list_agents(
        self,
        *,
        user_id: str,
        limit: int,
        offset: int,
    ) -> OwnerAgentPage | None:
        """Return portable owner Agents without deployment bindings or credentials."""
        return None

    async def read_memory(self, *, user_id: str) -> Mapping[str, Any] | None:
        """Return a portable memory document for exactly one owner, if supported."""
        return None

    async def read_files(
        self,
        *,
        user_id: str,
        max_files: int,
        max_total_bytes: int,
    ) -> OwnerFiles | None:
        """Return bounded regular file bytes from this owner's supported areas."""
        return None

    async def list_files(
        self,
        *,
        user_id: str,
        limit: int,
        offset: int,
        query: str = "",
    ) -> OwnerFilePage | None:
        """List owner file metadata for search without reading file contents."""
        return None

    async def read_thread_messages_page(
        self,
        *,
        user_id: str,
        thread_id: str,
        limit: int,
        before_seq: int | None = None,
    ) -> OwnerMessagePage | None:
        return None

    async def list_thread_runs(
        self,
        *,
        user_id: str,
        thread_id: str,
        limit: int,
        before_created_at: str | None = None,
        before_run_id: str | None = None,
    ) -> OwnerRunPage | None:
        """按 owner 和会话分页提供安全的执行状态、时间与 token 用量摘要。"""
        return None


class OwnerDataDeleter(Protocol):
    """Narrow host capability for deleting one explicitly-owned definition.

    Mutations are separate from ``OwnerDataReader`` so the read-only export
    contract cannot accidentally gain write access. Every operation must
    repeat the owner check at the storage boundary and be safe to retry.
    """

    async def delete_scheduled_task(
        self,
        *,
        user_id: str,
        task_id: str,
    ) -> str | None:
        """Return ``deleted``, ``not_found``, ``executing`` or ``None`` if unavailable."""
        return None

    async def delete_agent(
        self,
        *,
        user_id: str,
        name: str,
    ) -> str | None:
        """Delete one exact-owner custom Agent and its co-located user memory.

        Return ``deleted``, ``not_found``, ``legacy``, ``not_custom_agent`` or
        ``None`` when the Gateway does not provide this optional capability.
        Deployment-wide legacy definitions must never be deleted here.
        """
        return None

    async def delete_thread(
        self,
        *,
        user_id: str,
        thread_id: str,
    ) -> str | None:
        """在 Gateway durable reservation 下删除当前 owner 的会话。

        返回 ``deleted``、``not_found``、``executing``；宿主未提供此可选能力时返回 ``None``。
        """
        return None

    @property
    def supports_project_delete(self) -> bool:
        """Whether the host can remove an owned project definition safely."""
        return False

    async def delete_project(self, *, user_id: str, project_id: str) -> str | None:
        """Remove one owner's project definition through the host repository.

        The Gateway may move shelf documents to its recoverable Trash and detach
        conversations; this capability does not permanently erase those records.
        Return ``deleted``, ``not_found`` or ``None`` when unavailable.
        """
        return None

    @property
    def supports_memory_clear(self) -> bool:
        """是否配置的记忆后端实现了整位 owner 记忆清空能力。"""
        return False

    async def delete_memory(self, *, user_id: str) -> str | None:
        """清空明确 owner 的记忆摘要和事实；宿主或后端不支持时返回 ``None``。

        此范围只影响 Gateway 记忆后端，不删除 Agent 定义、会话、文件或凭据。
        """
        return None

    @property
    def supports_file_delete(self) -> bool:
        """Whether the host supports at least one owner-scoped file deletion path."""
        return False

    async def delete_file(self, *, user_id: str, file_id: str) -> str | None:
        """删除 Gateway 明确支持的本人文件；结果会说明删除或回收站语义。

        ``thread_upload`` 可以永久删除，项目资料可以移入回收站；只读输出或
        工作区文件应返回 ``unsupported``。调用方必须把 unsupported 作为未完成项。
        """
        return None


# --- Middleware -------------------------------------------------------------


class MiddlewareContributor(Protocol):
    def contribute_middlewares(
        self,
        app_store: ExtensionData,
        ctx: AgentBuildContext,
    ) -> Sequence[MiddlewarePlacement]:
        return ()


# --- Extension services ----------------------------------------------------


@dataclass(frozen=True)
class ExtensionRuntimeDeps:
    """Host capabilities bound after Gateway infrastructure is ready."""

    app_store: ExtensionData | None = None
    policy: HostPolicySnapshot = field(default_factory=HostPolicySnapshot)
    session_factory: Any | None = None
    run_evidence_reader: RunEvidenceReader | None = None
    # Read-only, owner-scoped metadata/history access for product-owned data
    # export jobs. Mutations and cross-owner reads remain outside this API.
    owner_data_reader: OwnerDataReader | None = None
    # Separate opt-in mutation capability; every write re-checks the owner.
    owner_data_deleter: OwnerDataDeleter | None = None
    # Re-resolves current route grants and data scopes for long-lived workers.
    owner_data_authorizer: OwnerDataAuthorizer | None = None
    # Gateway-owned persistent home subdirectory for extension artifacts. The
    # host creates no files on an extension's behalf; this path is a narrow
    # storage root for features such as short-lived export packages.
    product_data_directory: Path | None = None


class ExtensionService(Protocol):
    async def start(self, deps: ExtensionRuntimeDeps) -> None:
        return None

    async def stop(self) -> None:
        return None


# --- Registration surface ---------------------------------------------------


@runtime_checkable
class ExtensionRegistry(Protocol):
    """The write-only registration surface handed to ``install()``.

    Structural and minimal on purpose. Every method has a default so additive
    contract releases remain compatible with older registry implementations.
    The host's concrete registry additionally carries host-only machinery
    (attribution, positional rollback, build) that is deliberately absent here.
    """

    def middlewares(self, contributor: MiddlewareContributor) -> None:
        return None

    def task_lifecycle(self, contributor: TaskLifecycleContributor) -> None:
        return None

    def system_model_observer(self, observer: SystemModelCallObserver) -> None:
        return None

    def agent_assembly_observer(self, observer: AgentAssemblyObserver) -> None:
        return None

    def context_compaction_observer(self, observer: ContextCompactionObserver) -> None:
        return None

    def admin_action_observer(self, observer: AdminActionObserver) -> None:
        return None

    def service(self, service: ExtensionService) -> None:
        return None

    def routers(self, routers: Sequence[Any]) -> None:
        """Register HTTP routers constructed eagerly during extension install.

        Router types stay ``Any`` so this contract package has no FastAPI
        dependency. The host validates supported route shapes before mounting;
        runtime resources belong in a separately registered service.
        """
        return None


#: The install() entry point signature every extension exposes.
ExtensionInstall = Callable[[ExtensionRegistry, Mapping[str, Any]], None]


# --- Declaration decorator --------------------------------------------------


def extension(*, api: str, name: str | None = None) -> Callable[[F], F]:
    """Stamp an install function with the API version it was written against.

    Optional. pip's dependency resolution is the primary compatibility
    mechanism; this covers `--no-deps` installs and editable monorepo checkouts
    where versions can skew, and turns a deep AttributeError into an
    actionable startup diagnostic.
    """

    def _decorate(func: F) -> F:
        func.__deerflow_api__ = api  # type: ignore[attr-defined]
        func.__deerflow_name__ = name  # type: ignore[attr-defined]
        return func

    return _decorate
