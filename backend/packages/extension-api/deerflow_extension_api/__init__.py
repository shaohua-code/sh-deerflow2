"""Public contracts for DeerFlow extensions.

This package MUST NOT import `deerflow`. Every host contract an extension
needs lives here, while framework imports remain direct extension dependencies;
extensions can therefore be released independently of the host.
"""

from __future__ import annotations

from deerflow_extension_api.assembly import (
    AgentAssemblyDescriptor,
    AgentAssemblyObserver,
    MiddlewareDescriptor,
    ToolDescriptor,
)
from deerflow_extension_api.auth import (
    EXTENSION_DATA_SCOPE_CHECKER_KEY,
    EXTENSION_PRINCIPAL_RESOLVER_KEY,
    ExtensionDataScopeError,
    ExtensionPrincipal,
    OwnerDataAuthorizationError,
    require_admin,
    require_data_scope,
    require_permission,
    resolve_principal,
)
from deerflow_extension_api.compaction import (
    CompactionEvent,
    ContextCompactionObserver,
)
from deerflow_extension_api.contracts import (
    AdminActionEvent,
    AdminActionObserver,
    ExtensionInstall,
    ExtensionRegistry,
    ExtensionRuntimeDeps,
    ExtensionService,
    HostPolicySnapshot,
    MiddlewareContributor,
    OwnerAgentPage,
    OwnerDataAuthorizer,
    OwnerDataDeleter,
    OwnerDataReader,
    OwnerDataScope,
    OwnerFile,
    OwnerFileEntry,
    OwnerFilePage,
    OwnerFiles,
    OwnerMessagePage,
    OwnerProjectPage,
    OwnerRunPage,
    OwnerScheduledTaskPage,
    OwnerThreadPage,
    SystemModelCallObserver,
    SystemModelRequest,
    SystemModelResult,
    SystemOperationKind,
    TaskInfo,
    TaskLifecycleContributor,
    TaskOutcome,
    extension,
)
from deerflow_extension_api.placement import (
    AgentBuildContext,
    AgentScope,
    MiddlewarePlacement,
    Placement,
)
from deerflow_extension_api.provenance import (
    MESSAGE_CONTENT_KIND_KEY,
    MESSAGE_PRODUCER_ENTITY_ID_KEY,
    MESSAGE_PRODUCER_KIND_KEY,
    PROVENANCE_KEYS,
    ContentKind,
    MessageProvenance,
    provenance_kwargs,
    read_provenance,
)
from deerflow_extension_api.release import (
    ReleasePolicyProvider,
    canonical_hash,
    canonical_json,
    collect_release_policies,
)
from deerflow_extension_api.run_evidence import (
    InvalidRunEvidenceCursor,
    RunEventPage,
    RunEventView,
    RunEvidenceReader,
    RunPage,
    RunStatusView,
)
from deerflow_extension_api.runtime_bridge import (
    EXTENSION_TASK_STORE_KEY,
    task_store_from_runtime,
)
from deerflow_extension_api.state import ExtensionData

#: Contract version. Before 1.0, minors may break and patches are additive.
#: From 1.0 on, bump the major for breaking changes.
API_VERSION = "0.2.18"

__all__ = [
    "API_VERSION",
    "AdminActionEvent",
    "AdminActionObserver",
    "EXTENSION_PRINCIPAL_RESOLVER_KEY",
    "EXTENSION_DATA_SCOPE_CHECKER_KEY",
    "EXTENSION_TASK_STORE_KEY",
    "MESSAGE_CONTENT_KIND_KEY",
    "MESSAGE_PRODUCER_ENTITY_ID_KEY",
    "MESSAGE_PRODUCER_KIND_KEY",
    "PROVENANCE_KEYS",
    "AgentAssemblyDescriptor",
    "AgentAssemblyObserver",
    "AgentBuildContext",
    "AgentScope",
    "CompactionEvent",
    "ContentKind",
    "ContextCompactionObserver",
    "ExtensionData",
    "ExtensionDataScopeError",
    "ExtensionInstall",
    "ExtensionPrincipal",
    "ExtensionRegistry",
    "ExtensionRuntimeDeps",
    "ExtensionService",
    "HostPolicySnapshot",
    "InvalidRunEvidenceCursor",
    "MessageProvenance",
    "MiddlewareContributor",
    "MiddlewareDescriptor",
    "MiddlewarePlacement",
    "OwnerAgentPage",
    "OwnerDataAuthorizationError",
    "OwnerDataAuthorizer",
    "OwnerDataDeleter",
    "OwnerDataReader",
    "OwnerDataScope",
    "OwnerFile",
    "OwnerFileEntry",
    "OwnerFilePage",
    "OwnerFiles",
    "OwnerMessagePage",
    "OwnerProjectPage",
    "OwnerRunPage",
    "OwnerScheduledTaskPage",
    "OwnerThreadPage",
    "Placement",
    "ReleasePolicyProvider",
    "RunEvidenceReader",
    "RunEventPage",
    "RunEventView",
    "RunPage",
    "RunStatusView",
    "SystemModelCallObserver",
    "SystemModelRequest",
    "SystemModelResult",
    "SystemOperationKind",
    "TaskInfo",
    "TaskLifecycleContributor",
    "TaskOutcome",
    "ToolDescriptor",
    "canonical_hash",
    "canonical_json",
    "collect_release_policies",
    "extension",
    "provenance_kwargs",
    "read_provenance",
    "require_admin",
    "require_data_scope",
    "require_permission",
    "resolve_principal",
    "task_store_from_runtime",
]
