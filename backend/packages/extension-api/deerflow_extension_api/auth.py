"""The caller's identity, for contributed routes.

Contributed routers are constructed during install(), long before any request
exists, so identity cannot be handed to them at registration time. The host
instead installs a resolver on ``app.state`` and this module reads it back.

``request`` is duck-typed rather than annotated as a Starlette Request: this
package must not depend on a web framework.
"""

from __future__ import annotations

import inspect
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

EXTENSION_PRINCIPAL_RESOLVER_KEY = "deerflow_extension_principal_resolver"
EXTENSION_DATA_SCOPE_CHECKER_KEY = "deerflow_extension_data_scope_checker"


class ExtensionDataScopeError(PermissionError):
    """A host-owned data-scope decision that extensions can safely expose as HTTP.

    ``status_code`` is intentionally limited to authorization denial (403) and
    an unavailable/unrepresentable policy decision (503). The public contract
    stays independent from FastAPI while allowing a contributed router to
    preserve the host's fail-closed result.
    """

    def __init__(self, status_code: int, detail: str):
        if status_code not in {403, 503}:
            raise ValueError("data-scope errors must use status 403 or 503")
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class OwnerDataAuthorizationError(PermissionError):
    """A host-owned authorization decision for a background owner-data job."""

    def __init__(self, status_code: int, detail: str):
        if status_code not in {403, 503}:
            raise ValueError("owner-data authorization errors must use status 403 or 503")
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class ExtensionPrincipal:
    user_id: str
    is_admin: bool = False
    is_internal: bool = False
    roles: tuple[str, ...] = field(default_factory=tuple)
    # Filled from the Gateway's effective route scopes. Extensions can check a
    # stable string permission without importing Gateway AuthContext internals.
    permissions: tuple[str, ...] = field(default_factory=tuple)


def resolve_principal(request: object) -> ExtensionPrincipal | None:
    """Return the caller's principal, or ``None`` when it cannot be determined."""
    app = getattr(request, "app", None)
    state = getattr(app, "state", None)
    resolver = getattr(state, EXTENSION_PRINCIPAL_RESOLVER_KEY, None)
    if not callable(resolver):
        return None
    try:
        principal = resolver(request)
    except Exception as exc:  # noqa: BLE001 - an unanswerable identity is not an error to propagate
        logger.warning("extension principal resolver failed: %s", type(exc).__name__)
        return None
    return principal if isinstance(principal, ExtensionPrincipal) else None


def require_admin(request: object) -> ExtensionPrincipal:
    """Return the principal when it is an admin, else raise ``PermissionError``.

    Fails closed on an absent or failing resolver: an authorization question the
    host cannot answer must never resolve to "allowed".
    """
    principal = resolve_principal(request)
    if principal is None or not principal.is_admin:
        raise PermissionError("this endpoint requires an administrator account")
    return principal


def require_permission(request: object, permission: str) -> ExtensionPrincipal:
    """Require an effective Gateway permission without importing host policy."""
    if not isinstance(permission, str) or not permission:
        raise ValueError("permission must be a non-empty string")
    principal = resolve_principal(request)
    if principal is None or permission not in principal.permissions:
        raise PermissionError(f"this endpoint requires {permission}")
    return principal


async def require_data_scope(
    request: object,
    *,
    target: str,
    action: str = "read",
    resource_id: str | None = None,
) -> None:
    """Ask the Gateway to enforce its current row-level IAM scope.

    The host owns the provider, identity mapping, and owner checks. Extensions
    pass only stable route target/action values and an optional opaque resource
    ID; they never receive IAM credentials or provider internals.
    """
    if not isinstance(target, str) or not target:
        raise ValueError("target must be a non-empty string")
    if not isinstance(action, str) or not action:
        raise ValueError("action must be a non-empty string")
    if resource_id is not None and not isinstance(resource_id, str):
        raise ValueError("resource_id must be a string or None")

    app = getattr(request, "app", None)
    state = getattr(app, "state", None)
    checker = getattr(state, EXTENSION_DATA_SCOPE_CHECKER_KEY, None)
    if not callable(checker):
        raise ExtensionDataScopeError(503, "IAM data-scope authorization is unavailable")

    try:
        result = checker(
            request,
            target=target,
            action=action,
            resource_id=resource_id,
        )
        if not inspect.isawaitable(result):
            raise TypeError("the host data-scope checker must be asynchronous")
        await result
    except ExtensionDataScopeError:
        raise
    except Exception as exc:  # noqa: BLE001 - a failed authorization must fail closed
        logger.warning("extension data-scope checker failed: %s", type(exc).__name__)
        raise ExtensionDataScopeError(503, "IAM data-scope authorization is unavailable") from None
