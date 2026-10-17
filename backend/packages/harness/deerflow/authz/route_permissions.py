"""Read the Gateway's server-owned route permission snapshot from a run."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

ROUTE_PERMISSIONS_CONTEXT_KEY = "route_permissions"


def missing_runtime_route_permissions(runtime: Any, required: Sequence[str]) -> tuple[str, ...]:
    """Return permissions missing from a trusted ``ToolRuntime`` context.

    Older embedded Harness callers do not provide a route snapshot, so absence
    remains compatible with the pre-RBAC behavior. The Gateway stamps the key
    after stripping caller values; when present, malformed data fails closed.
    """
    context = getattr(runtime, "context", None)
    if not isinstance(context, Mapping) or ROUTE_PERMISSIONS_CONTEXT_KEY not in context:
        return ()

    granted = context[ROUTE_PERMISSIONS_CONTEXT_KEY]
    if not isinstance(granted, (list, tuple, set, frozenset)) or not all(isinstance(item, str) for item in granted):
        return tuple(required)
    return tuple(permission for permission in required if permission not in granted)
