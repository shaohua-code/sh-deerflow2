"""Shared route and owner-scope requirements for product data operations.

The request API uses this table when a job is submitted or viewed. The worker
uses the same table after claiming a job and at each progress boundary, so an
old queued task cannot retain the permission snapshot from its creator.
"""

from __future__ import annotations

from deerflow_extension_api import OwnerDataScope

DATA_EXPORT_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "preferences": ("preferences:read",),
    # Thread exports include safe run usage summaries as well as messages.
    "threads": ("threads:read", "runs:read"),
    "projects": ("projects:read",),
    "scheduled_tasks": ("threads:read",),
    "agents": ("agents:read",),
    "memory": ("memory:read",),
    "files": ("threads:read", "projects:read"),
}
DATA_DELETION_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "preferences": ("preferences:write",),
    "threads": ("threads:delete",),
    "scheduled_tasks": ("threads:delete",),
    "agents": ("agents:delete",),
    "projects": ("projects:delete",),
    "memory": ("memory:delete",),
    # The files operation covers both thread uploads and project documents.
    "files": ("threads:delete", "projects:delete"),
}
ACCOUNT_EXPORT_PERMISSIONS = tuple(
    dict.fromkeys(
        permission
        for scope_permissions in DATA_EXPORT_PERMISSIONS.values()
        for permission in scope_permissions
    )
)


def required_data_job_permissions(kind: str, scope: str) -> tuple[str, ...] | None:
    """Return the exact route grants required by one persisted job scope."""
    if kind == "export" and scope == "account":
        return ACCOUNT_EXPORT_PERMISSIONS
    if kind == "export":
        return DATA_EXPORT_PERMISSIONS.get(scope)
    if kind == "deletion":
        return DATA_DELETION_PERMISSIONS.get(scope)
    return None


def required_data_job_scopes(kind: str, scope: str) -> tuple[OwnerDataScope, ...]:
    """Project route grants into framework-free Gateway authorization requests."""
    permissions = required_data_job_permissions(kind, scope)
    if not permissions:
        return ()
    return tuple(
        OwnerDataScope(target=permission, action=permission.partition(":")[2])
        for permission in permissions
    )
