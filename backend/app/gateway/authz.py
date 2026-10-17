"""Authorization decorators and context for DeerFlow.

Inspired by LangGraph Auth system: https://github.com/langchain-ai/langgraph/blob/main/libs/sdk-py/langgraph_sdk/auth/__init__.py

**Usage:**

1. Use ``@require_auth`` on routes that need authentication
2. Use ``@require_permission("resource", "action", filter_key=...)`` for permission checks
3. The decorator chain processes from bottom to top

**Example:**

    @router.get("/{thread_id}")
    @require_auth
    @require_permission("threads", "read", owner_check=True)
    async def get_thread(thread_id: str, request: Request):
        # User is authenticated and has threads:read permission
        ...

**Permission Model:**

- threads:read   - View thread
- threads:write  - Create/update thread
- threads:delete - Delete thread
- runs:create   - Run agent
- runs:read     - View run
- runs:cancel   - Cancel run
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import logging
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, ParamSpec, TypeVar

from fastapi import HTTPException, Request

from deerflow.authz.principal import build_principal_from_context
from deerflow.authz.provider import AuthorizationProvider, AuthzRequest, Principal, is_authz_decision
from deerflow.authz.runtime import resolve_authorization_provider
from deerflow.config.authorization_config import AuthorizationConfig

if TYPE_CHECKING:
    from app.gateway.auth.models import User
    from deerflow.config.app_config import AppConfig

P = ParamSpec("P")
T = TypeVar("T")
logger = logging.getLogger(__name__)


# Permission constants
class Permissions:
    """Permission constants for resource:action format."""

    # Threads
    THREADS_READ = "threads:read"
    THREADS_WRITE = "threads:write"
    THREADS_DELETE = "threads:delete"

    # Runs
    RUNS_CREATE = "runs:create"
    RUNS_READ = "runs:read"
    RUNS_CANCEL = "runs:cancel"
    # Projects
    PROJECTS_READ = "projects:read"
    PROJECTS_WRITE = "projects:write"
    PROJECTS_DELETE = "projects:delete"

    # Custom Agent definitions are scoped to the current Gateway user. The
    # global USER.md endpoint uses AGENTS_ADMIN because it is injected into
    # every custom Agent in this deployment.
    AGENTS_READ = "agents:read"
    AGENTS_WRITE = "agents:write"
    AGENTS_DELETE = "agents:delete"
    AGENTS_ADMIN = "agents:admin"

    # Per-user memory API access; config inspection is administrative.
    MEMORY_READ = "memory:read"
    MEMORY_WRITE = "memory:write"
    MEMORY_DELETE = "memory:delete"
    MEMORY_ADMIN = "memory:admin"

    # 当前登录用户的工作台偏好；服务端还会检查 session 和本地 owner。
    PREFERENCES_READ = "preferences:read"
    PREFERENCES_WRITE = "preferences:write"

    # User-owned external connector bindings; runtime secrets stay admin-only.
    CHANNELS_READ = "channels:read"
    CHANNELS_WRITE = "channels:write"
    CHANNELS_ADMIN = "channels:admin"
    INTEGRATIONS_READ = "integrations:read"
    INTEGRATIONS_WRITE = "integrations:write"
    INTEGRATIONS_ADMIN = "integrations:admin"

    # User-owned skill content and deployment-wide skill configuration.
    SKILLS_READ = "skills:read"
    SKILLS_WRITE = "skills:write"
    SKILLS_DELETE = "skills:delete"
    SKILLS_ADMIN = "skills:admin"

    # Shared managed subagent catalog and MCP runtime configuration.
    SUBAGENTS_READ = "subagents:read"
    SUBAGENTS_ADMIN = "subagents:admin"
    MCP_ADMIN = "mcp:admin"


class AuthContext:
    """Authentication context for the current request.

    Stored in request.state.auth after require_auth decoration.

    Attributes:
        user: The authenticated user, or None if anonymous
        permissions: List of permission strings (e.g., "threads:read")
    """

    __slots__ = ("user", "permissions")

    def __init__(self, user: User | None = None, permissions: list[str] | None = None):
        self.user = user
        self.permissions = permissions or []

    @property
    def is_authenticated(self) -> bool:
        """Check if user is authenticated."""
        return self.user is not None

    def has_permission(self, resource: str, action: str) -> bool:
        """Check if context has permission for resource:action.

        Args:
            resource: Resource name (e.g., "threads")
            action: Action name (e.g., "read")

        Returns:
            True if user has permission
        """
        permission = f"{resource}:{action}"
        return permission in self.permissions

    def require_user(self) -> User:
        """Get user or raise 401.

        Raises:
            HTTPException 401 if not authenticated
        """
        if not self.user:
            raise HTTPException(status_code=401, detail="Authentication required")
        return self.user


@dataclass(slots=True)
class ScheduledTaskAuthorizationContext:
    """Short-lived owner authorization resolved for one scheduled occurrence.

    The IAM credential capability is memory-only and is passed to the run
    worker through ``RunContext``; callers must never persist or serialize it.
    """

    user: Any
    auth: AuthContext
    authz_attributes: dict[str, Any]


async def resolve_scheduled_task_authorization(
    user_id: str,
    *,
    context_mode: str,
    thread_id: str | None,
    thread_store: Any,
) -> ScheduledTaskAuthorizationContext:
    """Reauthorize one scheduled Agent occurrence as its active owner.

    Scheduled runs outlive their creating HTTP request. Before a worker is
    admitted, reload the owner, resolve a currently active server-side OIDC
    vault session, re-evaluate route grants, and apply the same owner data
    scopes used by interactive run admission. If no Central IAM provider is
    configured, local RBAC remains the source of route permissions and the
    repository/thread owner checks remain mandatory.
    """
    from app.gateway.auth_disabled import AUTH_SOURCE_SESSION
    from app.gateway.deps import get_local_provider

    user = await get_local_provider().get_user(user_id)
    if user is None or not getattr(user, "is_active", False):
        raise HTTPException(status_code=403, detail="Scheduled tasks are unavailable for this account")

    authorization_config = _get_route_authorization_config()
    provider = None
    if authorization_config.enabled is True:
        try:
            provider = _get_cached_route_provider(authorization_config)
        except Exception:
            logger.warning("Could not resolve authorization provider for scheduled task admission")
            raise HTTPException(status_code=503, detail="Scheduled task authorization is unavailable") from None
        if provider is None:
            raise HTTPException(status_code=503, detail="Scheduled task authorization is unavailable")

    authz_attributes: dict[str, Any] = {}
    is_central_iam = provider is not None and (getattr(provider, "requires_iam_identity", False) is True or getattr(provider, "name", None) == "central-iam")
    if is_central_iam:
        try:
            from app.gateway.auth.iam_token_vault import load_active_iam_authorization_attributes
            from app.gateway.routers.auth import _get_oidc_service
            from deerflow.config.app_config import get_app_config

            app_config = get_app_config()
            authz_attributes = await load_active_iam_authorization_attributes(
                user=user,
                provider_configs=app_config.auth.oidc.providers,
                oidc_service=_get_oidc_service(),
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Could not resolve an active IAM vault session for scheduled task admission")
            raise HTTPException(status_code=503, detail="Scheduled task IAM authorization is unavailable") from None
        credentials = authz_attributes.get("iam_credentials")
        if credentials is None:
            raise HTTPException(status_code=403, detail="An active IAM session is required to run this scheduled task")

    permissions = await resolve_route_permissions(
        user,
        is_internal=False,
        authz_attributes=authz_attributes,
    )
    auth = AuthContext(user=user, permissions=permissions)
    if not auth.has_permission("threads", "write") or not auth.has_permission("runs", "create"):
        raise HTTPException(status_code=403, detail="Permission denied: scheduled task run creation")

    synthetic_request = SimpleNamespace(
        state=SimpleNamespace(
            user=user,
            auth=auth,
            auth_source=AUTH_SOURCE_SESSION,
            iam_authz_attributes=authz_attributes,
        ),
        headers={},
    )
    await require_iam_data_scope_for_request(
        synthetic_request,
        user,
        target="threads:write",
        action="write",
    )
    await require_iam_data_scope_for_request(
        synthetic_request,
        user,
        target="runs:create",
        action="create",
    )

    if context_mode == "reuse_thread":
        if not isinstance(thread_id, str) or not thread_id:
            raise HTTPException(status_code=403, detail="Scheduled task thread is unavailable")
        if not auth.has_permission("threads", "read"):
            raise HTTPException(status_code=403, detail="Permission denied: threads:read")
        if not await thread_store.check_access(thread_id, str(user.id), require_existing=True):
            raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")
        await require_iam_data_scope_for_request(
            synthetic_request,
            user,
            target="threads:read",
            action="read",
            resource_id=thread_id,
        )
        await require_iam_data_scope_for_request(
            synthetic_request,
            user,
            target="threads:write",
            action="write",
            resource_id=thread_id,
        )

    return ScheduledTaskAuthorizationContext(user=user, auth=auth, authz_attributes=authz_attributes)


def get_auth_context(request: Request) -> AuthContext | None:
    """Get AuthContext from request state."""
    return getattr(request.state, "auth", None)


def require_cancel_permission_if(request: Request, can_cancel: bool) -> None:
    """Require ``runs:cancel`` when a request carries cancel capability.

    Cancel capability reaches the run lifecycle through more than the dedicated
    cancel route: ``?action=interrupt|rollback`` on the join-stream entry and
    ``multitask_strategy=interrupt|rollback`` on run creation both terminate an
    already-active run. A credential whose scopes omit ``runs:cancel`` (e.g. a
    create- or read-only PAT) must not reach any of those paths, and
    decorators cannot express query- or body-parameter-conditional
    permissions, so callers apply this check where the capability is known.

    ``request.state.auth`` may be absent in middleware-less compositions
    (unit-test stubs, auth-disabled startup); the shipped Gateway always
    stamps it via ``AuthMiddleware`` before handlers run.
    """
    if not can_cancel:
        return
    auth = getattr(request.state, "auth", None)
    if auth is not None and not auth.has_permission("runs", "cancel"):
        raise HTTPException(status_code=403, detail="Permission denied: runs:cancel")


_ALL_PERMISSIONS: list[str] = [
    Permissions.THREADS_READ,
    Permissions.THREADS_WRITE,
    Permissions.THREADS_DELETE,
    Permissions.RUNS_CREATE,
    Permissions.RUNS_READ,
    Permissions.RUNS_CANCEL,
    Permissions.PROJECTS_READ,
    Permissions.PROJECTS_WRITE,
    Permissions.PROJECTS_DELETE,
    Permissions.MEMORY_READ,
    Permissions.MEMORY_WRITE,
    Permissions.MEMORY_DELETE,
    Permissions.MEMORY_ADMIN,
    Permissions.PREFERENCES_READ,
    Permissions.PREFERENCES_WRITE,
    Permissions.AGENTS_READ,
    Permissions.AGENTS_WRITE,
    Permissions.AGENTS_DELETE,
    Permissions.AGENTS_ADMIN,
    Permissions.CHANNELS_READ,
    Permissions.CHANNELS_WRITE,
    Permissions.CHANNELS_ADMIN,
    Permissions.INTEGRATIONS_READ,
    Permissions.INTEGRATIONS_WRITE,
    Permissions.INTEGRATIONS_ADMIN,
    Permissions.SKILLS_READ,
    Permissions.SKILLS_WRITE,
    Permissions.SKILLS_DELETE,
    Permissions.SKILLS_ADMIN,
    Permissions.SUBAGENTS_READ,
    Permissions.SUBAGENTS_ADMIN,
    Permissions.MCP_ADMIN,
]


def _make_test_request_stub() -> Any:
    """Create a minimal request-like object for direct unit calls.

    Used when decorated route handlers are invoked without FastAPI's
    request injection. Includes fields accessed by auth helpers.
    """
    return SimpleNamespace(state=SimpleNamespace(), cookies={}, _deerflow_test_bypass_auth=True)


def _get_route_authorization_config() -> AuthorizationConfig:
    """Return the hot-reloaded authorization config for this request.

    Falls back to a disabled config when AppConfig is not available (e.g. test
    environments without a config.yaml), preserving legacy all-permissions behavior.
    """
    from deerflow.config.app_config import get_app_config

    try:
        return get_app_config().authorization
    except (FileNotFoundError, RuntimeError):
        return AuthorizationConfig()


# --- Provider cache (W1/F1) ---
# Keyed by config object identity (id) so the expensive model_dump() signature
# is only recomputed when get_app_config() returns a new object (hot-reload).
_route_provider_cache: dict[str, AuthorizationProvider] = {}
_route_provider_config_id: int | None = None
_route_provider_config_sig: str | None = None


def _get_cached_route_provider(config: AuthorizationConfig) -> AuthorizationProvider | None:
    """Resolve (or reuse) the authorization provider for route permissions.

    The provider is cached per config object identity. When ``get_app_config()``
    returns a new object (hot-reload), the signature is recomputed and compared;
    only an actual content change triggers re-resolution. This avoids calling
    ``model_dump()`` on every request — the fast path is a single ``id()`` check.
    """
    global _route_provider_config_id, _route_provider_config_sig, _route_provider_cache

    config_id = id(config)

    # Fast path: same config object as last time → return cached provider.
    if config_id == _route_provider_config_id and _route_provider_cache:
        return _route_provider_cache.get("provider")

    # Config object changed (hot-reload): compute signature to check if
    # content actually changed or just the wrapper object identity.
    sig = repr(sorted(config.model_dump().items()))
    if sig == _route_provider_config_sig and _route_provider_cache:
        # Same content, different object — update id, reuse provider.
        _route_provider_config_id = config_id
        return _route_provider_cache.get("provider")

    # Content changed (or first call): re-resolve into a local first,
    # then publish id + sig + provider together to avoid a race window.
    _route_provider_cache.clear()

    provider = resolve_authorization_provider(config)
    if provider is not None:
        _route_provider_cache["provider"] = provider
    _route_provider_config_id = config_id
    _route_provider_config_sig = sig
    return provider


async def resolve_route_permissions(
    user: User,
    *,
    is_internal: bool,
    authz_attributes: dict[str, Any] | None = None,
) -> list[str]:
    """Return the route permissions granted to an authenticated user.

    Disabled authorization preserves the legacy all-permissions behavior.
    When enabled, every registered ``resource:action`` permission is evaluated
    independently so a provider failure affects only the route being checked.
    Provider instances are cached per config signature (hot-reload safe).
    """
    config = _get_route_authorization_config()
    if config.enabled is not True:
        return list(_ALL_PERMISSIONS)

    try:
        provider = _get_cached_route_provider(config)
        if provider is None:
            raise ValueError("authorization is enabled but provider resolution returned None")
    except Exception:
        logger.warning("Failed to resolve authorization provider for Gateway routes", exc_info=True)
        return [] if config.fail_closed else list(_ALL_PERMISSIONS)

    # Align with Phase 1B's tool path: internal callers (IM channel workers,
    # scheduler) have system_role="internal", which is not a real RBAC role.
    # Omit it so default_role applies, mirroring inject_authenticated_user_context
    # which pops user_role for internal callers without a resolved owner.
    from app.gateway.internal_auth import INTERNAL_SYSTEM_ROLE

    user_role = getattr(user, "system_role", None)
    if user_role == INTERNAL_SYSTEM_ROLE:
        user_role = None

    principal = build_principal_from_context(
        {
            "user_id": str(user.id),
            "user_role": user_role,
            "oauth_provider": getattr(user, "oauth_provider", None),
            "oauth_id": getattr(user, "oauth_id", None),
            "is_internal": is_internal,
            "authz_attributes": authz_attributes,
        },
        default_role=config.default_role,
    )

    # Evaluate all permissions in parallel (W2).
    async def _evaluate(permission: str) -> str | None:
        _, action = permission.split(":", maxsplit=1)
        request = AuthzRequest(
            principal=principal,
            resource="route",
            action=action,
            target=permission,
        )
        try:
            decision = await provider.aauthorize(request)
            if not is_authz_decision(decision):
                raise TypeError("AuthorizationProvider.aauthorize must return AuthzDecision")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning(
                "Authorization provider failed while evaluating route permission %s",
                permission,
                exc_info=True,
            )
            return permission if not config.fail_closed else None
        return permission if decision.allow else None

    results = await asyncio.gather(*[_evaluate(p) for p in _ALL_PERMISSIONS])
    return [p for p in results if p is not None]


async def resolve_route_permissions_for_request(request: Request, user: Any) -> list[str]:
    """Resolve the effective route permissions for a request's authenticated user.

    Public wrapper pairing ``resolve_route_permissions`` with the internal-caller
    heuristics of ``_is_internal_caller`` (auth source, synthetic internal role,
    internal auth header), so middleware-less consumers resolve exactly what
    ``_authenticate`` resolves and the two cannot drift apart.
    """
    authz_attributes: dict[str, Any] | None = None
    config = _get_route_authorization_config()
    if config.enabled is True:
        try:
            provider = _get_cached_route_provider(config)
        except Exception:
            provider = None  # resolve_route_permissions applies the configured failure policy below
        if provider is not None and (getattr(provider, "requires_iam_identity", False) is True or getattr(provider, "name", None) == "central-iam"):
            try:
                from app.gateway.auth.iam_token_vault import load_iam_authorization_attributes
                from app.gateway.routers.auth import _get_oidc_service
                from deerflow.config.app_config import get_app_config

                app_config = get_app_config()
                authz_attributes = await load_iam_authorization_attributes(
                    user=user,
                    session_id=getattr(request.state, "iam_session_id", None),
                    provider_configs=app_config.auth.oidc.providers,
                    oidc_service=_get_oidc_service(),
                )
            except Exception:
                # Keep token, provider URL, and DB/network exception details out of logs.
                logger.warning("Could not resolve a server-side IAM session for Gateway authorization")
                authz_attributes = {}
            # Request state is transient and is consumed only by other Gateway
            # authorization paths during this HTTP request (models/sandbox).
            request.state.iam_authz_attributes = authz_attributes

    return await resolve_route_permissions(
        user,
        is_internal=_is_internal_caller(request, user),
        authz_attributes=authz_attributes,
    )


_STREAM_RECHECK_COOKIE_NAME = "access_token"


async def recheck_stream_permission(
    request: Request,
    resource: str,
    action: str,
    *,
    data_scope_target: str | None = None,
    data_scope_action: str | None = None,
) -> bool:
    """Re-evaluate one route permission for an in-flight SSE stream.

    Streaming responses outlive the request that created them: the
    ``@require_permission`` decorator only ran once at connection setup, so a
    permission revoked (or an account deactivated) mid-run would otherwise
    keep streaming until the run finishes. The SSE heartbeat callback calls
    this periodically to close that gap.

    Re-resolution deliberately bypasses the ``request.state.user`` cache and
    re-reads the account from the local repository so a role change or
    deactivation is observed without waiting for a new request. Returns:

    - ``False`` — authorization is enabled and the re-loaded account is
      deactivated, no longer holds ``resource:action``, or (when
      ``data_scope_target`` is given) lost its Central IAM row scope; the
      caller must stop streaming.
    - ``True`` — still allowed, or the check could not be performed
      (authorization disabled, no session cookie for non-cookie callers,
      transient lookup failure). Fail-open keeps transient infrastructure
      errors from tearing down healthy runs; connection setup remains the
      authoritative grant for those callers.

    ``data_scope_target``/``data_scope_action`` mirror the endpoint's
    ``require_iam_data_scope_for_request`` call so a mid-run Central IAM
    scope revocation also terminates the stream. They are evaluated against
    the freshly reloaded identity only — the checked call re-reads the
    ``iam_authz_attributes`` that ``resolve_route_permissions_for_request``
    just refreshed on ``request.state``, so no stale connection-setup
    snapshot is consulted.
    """
    config = _get_route_authorization_config()
    if config.enabled is not True:
        # Legacy all-permissions mode: nothing to re-evaluate (mirrors
        # resolve_route_permissions' disabled fast path).
        return True

    try:
        # Cookie callers are re-resolved from the repository so a mid-run
        # role change or deactivation is observed. Non-cookie callers (PAT,
        # internal) have no session cookie to refresh; their identity stays
        # the one authenticated at connection setup and their grants are
        # still re-evaluated below against current provider state.
        fresh_user: Any = getattr(getattr(request, "state", None), "user", None)
        access_token = request.cookies.get(_STREAM_RECHECK_COOKIE_NAME)
        if access_token:
            from app.gateway.auth import decode_token
            from app.gateway.auth.errors import TokenError
            from app.gateway.deps import get_local_provider

            payload = decode_token(access_token)
            if isinstance(payload, TokenError):
                # Session token expired/revoked mid-stream: deny outright —
                # a fresh request with this cookie would fail auth too.
                return False
            user = await get_local_provider().get_user(payload.sub)
            if user is None or not getattr(user, "is_active", False):
                return False
            fresh_user = user

        if fresh_user is None:
            # Unidentifiable caller (no cookie, nothing stamped on state):
            # keep the connection-setup grant rather than inventing a deny.
            return True

        permissions = await resolve_route_permissions_for_request(request, fresh_user)
        if f"{resource}:{action}" not in permissions:
            return False

        if data_scope_target is not None:
            # require_iam_data_scope_for_request reports denials as 403 and
            # infrastructure gaps as 503; translate so only an explicit scope
            # revocation ends the stream (transient IAM failures fail open,
            # mirroring the permission path above).
            try:
                await require_iam_data_scope_for_request(
                    request,
                    fresh_user,
                    target=data_scope_target,
                    action=data_scope_action or "read",
                )
            except HTTPException as exc:
                if exc.status_code == 403:
                    return False
                logger.warning(
                    "Stream data-scope recheck unavailable for %s; keeping the stream open",
                    data_scope_target,
                )
                return True
        return True
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.warning(
            "Stream permission recheck failed for %s:%s; keeping the stream open",
            resource,
            action,
            exc_info=True,
        )
        return True


class _AuthorizationUnavailable(Exception):
    """Raised internally when the provider cannot be resolved for a route check.

    Carries the ``fail_closed`` flag so the caller can decide between deny-all
    and legacy allow-all without re-reading config.
    """

    def __init__(self, *, fail_closed: bool) -> None:
        self.fail_closed = fail_closed


def resolve_model_authorization(
    user: User,
    *,
    is_internal: bool,
    authz_attributes: dict[str, Any] | None = None,
) -> tuple[AuthorizationProvider | None, Principal | None]:
    """Return ``(provider, principal)`` for model-route authorization.

    When authorization is disabled, returns ``(None, None)`` so callers can
    short-circuit to legacy behavior (all models visible). When enabled,
    resolves the cached provider and builds a Principal identical to
    ``resolve_route_permissions`` (including the ``INTERNAL_SYSTEM_ROLE``
    → ``None`` pop so internal callers fall under ``default_role``).

    Raises ``_AuthorizationUnavailable`` (carrying the ``fail_closed`` flag)
    when the provider cannot be resolved; callers translate that into the
    appropriate deny response (empty list / 403).
    """
    config = _get_route_authorization_config()
    if config.enabled is not True:
        return None, None

    try:
        provider = _get_cached_route_provider(config)
        if provider is None:
            raise ValueError("authorization is enabled but provider resolution returned None")
    except Exception:
        logger.warning("Failed to resolve authorization provider for model routes", exc_info=True)
        raise _AuthorizationUnavailable(fail_closed=config.fail_closed)

    principal = build_principal_from_context(
        _route_authz_context(user, is_internal=is_internal, authz_attributes=authz_attributes),
        default_role=config.default_role,
    )
    return provider, principal


def _route_authz_context(
    user: User,
    *,
    is_internal: bool,
    authz_attributes: dict[str, Any] | None = None,
) -> dict:
    """Build the shared Principal context dict for a request-scoped user.

    Applies the ``INTERNAL_SYSTEM_ROLE → None`` pop so internal callers fall
    under ``default_role`` (mirrors ``inject_authenticated_user_context``).
    Used by ``resolve_model_authorization`` and ``authorize_sandbox_for_request``
    so every route-level authorization path builds the identity the same way.
    """
    from app.gateway.internal_auth import INTERNAL_SYSTEM_ROLE

    user_role = getattr(user, "system_role", None)
    if user_role == INTERNAL_SYSTEM_ROLE:
        user_role = None
    return {
        "user_id": str(user.id),
        "user_role": user_role,
        "oauth_provider": getattr(user, "oauth_provider", None),
        "oauth_id": getattr(user, "oauth_id", None),
        "is_internal": is_internal,
        "authz_attributes": authz_attributes,
    }


async def require_iam_data_scope_for_request(
    request: Request,
    user: Any | None,
    *,
    target: str,
    action: str = "read",
    resource_id: str | None = None,
) -> None:
    """Check Central IAM row scope before returning owner-scoped records.

    DeerFlow currently stores project/thread rows with a local ``user_id``
    owner, but has no trusted tenant or organization ownership columns. This
    bridge therefore accepts only IAM ``owner_user_id`` scopes that match the
    verified OIDC subject; the repository still filters by the local user ID.
    Broader tenant/organization scopes fail closed until DeerFlow can represent
    and migrate those ownership relationships.
    """
    if getattr(request, "_deerflow_test_bypass_auth", False):
        return

    config = _get_route_authorization_config()
    if config.enabled is not True:
        return
    try:
        provider = _get_cached_route_provider(config)
    except Exception:
        logger.warning("Could not resolve Central IAM data-scope provider")
        raise HTTPException(status_code=503, detail="IAM data-scope authorization is unavailable") from None

    # The central IAM contract is optional when DeerFlow is configured with
    # its local RBAC provider; that provider has no remote row-scope API.
    if provider is None or not (getattr(provider, "requires_iam_identity", False) is True or getattr(provider, "name", None) == "central-iam"):
        return

    # Some read routers rely on the Gateway middleware rather than a permission
    # decorator. Resolve the auth user only after Central IAM is confirmed, so
    # local-RBAC and legacy test clients retain their existing behavior.
    if user is None:
        auth = getattr(request.state, "auth", None)
        user = getattr(auth, "user", None) or getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=503, detail="IAM data-scope authorization is unavailable")

    checker = getattr(provider, "aresolve_data_scope", None)
    if not callable(checker):
        raise HTTPException(status_code=503, detail="IAM data-scope authorization is unavailable")

    authz_attributes = getattr(request.state, "iam_authz_attributes", None)
    principal = build_principal_from_context(
        _route_authz_context(
            user,
            is_internal=_is_internal_caller(request, user),
            authz_attributes=authz_attributes,
        ),
        default_role=config.default_role,
    )
    context: dict[str, Any] = {"route_target": target}
    if resource_id is not None:
        context["resource_id"] = resource_id
    try:
        decision = await checker(
            principal,
            resource="route",
            action=action,
            target=target,
            context=context,
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.warning("Central IAM data-scope request failed")
        raise HTTPException(status_code=503, detail="IAM data-scope authorization is unavailable") from None

    if getattr(decision, "allow", False) is not True:
        raise HTTPException(status_code=403, detail="Permission denied by Central IAM data scope")

    metadata = getattr(decision, "metadata", None)
    scope = metadata.get("data_scope") if isinstance(metadata, Mapping) else None
    credentials = authz_attributes.get("iam_credentials") if isinstance(authz_attributes, Mapping) else None
    subject = credentials.get("iam_subject") if isinstance(credentials, Mapping) else None
    tenant_id = credentials.get("iam_tenant_id") if isinstance(credentials, Mapping) else None
    constraints = scope.get("constraints") if isinstance(scope, Mapping) else None
    if not isinstance(scope, Mapping) or scope.get("mode") != "any_of" or not isinstance(constraints, list) or not constraints or not isinstance(subject, str) or subject != getattr(user, "oauth_id", None) or not isinstance(tenant_id, str):
        raise HTTPException(status_code=503, detail="IAM data scope cannot be applied to this resource")

    # Existing repositories enforce local user ownership. Until DeerFlow has
    # tenant/org columns and a verified IAM-to-local identity mapping, do not
    # interpret broader IAM scopes as permission to expose another user's rows.
    for constraint in constraints:
        branch_tenant_id = constraint.get("tenant_id") if isinstance(constraint, Mapping) else None
        if (
            not isinstance(constraint, Mapping)
            or constraint.get("kind") != "owner"
            or constraint.get("field") != "owner_user_id"
            or constraint.get("user_id") != subject
            or not isinstance(branch_tenant_id, str)
            or branch_tenant_id.lower() != tenant_id.lower()
        ):
            raise HTTPException(status_code=503, detail="IAM data scope cannot be applied to this resource")


def authorize_sandbox_for_request(
    user: User,
    *,
    is_internal: bool,
    app_config: AppConfig | None,
    authz_attributes: dict[str, Any] | None = None,
) -> None:
    """Check ``sandbox:execute`` for a Gateway request before sandbox acquisition.

    Thin wrapper over the harness-level ``authorize_sandbox_execution`` that
    builds the Principal from the request-scoped ``user`` — the same identity
    construction as ``resolve_model_authorization`` (including the
    ``INTERNAL_SYSTEM_ROLE → None`` pop). Raises
    :class:`~deerflow.sandbox.exceptions.SandboxAuthorizationError` on deny or
    on provider-resolution failure under ``fail_closed``; callers translate
    that into skipping the sandbox sync (not an HTTP error, since the primary
    operation — e.g. file upload — can proceed without it).

    No-op when ``authorization.enabled`` is false.
    """
    from deerflow.authz.sandbox_authz import authorize_sandbox_execution
    from deerflow.sandbox.exceptions import SandboxAuthorizationError

    config = _get_route_authorization_config()
    if config.enabled is not True:
        return

    context = _route_authz_context(user, is_internal=is_internal, authz_attributes=authz_attributes)

    try:
        authorize_sandbox_execution(
            context=context,
            app_config=app_config,
        )
    except SandboxAuthorizationError:
        raise
    except Exception:
        # Defense-in-depth: provider resolution and authorize() errors are
        # already converted to SandboxAuthorizationError (or allowed under
        # fail-open) one layer down inside authorize_sandbox_execution, so this
        # normally only catches config-read failures here (e.g. get_config()
        # raising in a config-less environment). Those must not 500 the
        # upload/artifact route — degrade per fail_closed instead.
        logger.warning("Failed to resolve authorization provider for sandbox:execute", exc_info=True)
        if config.fail_closed:
            raise SandboxAuthorizationError(role=context.get("user_role")) from None


@dataclass(slots=True)
class SandboxRequestLease:
    """One Gateway request's process-local use of a sandbox client."""

    sandbox: object | None
    sandbox_id: str | None
    denied: bool
    owner_id: str | None
    provider: object | None

    async def release(self) -> None:
        """Drop the request holder without bypassing concurrent executions."""
        if self.owner_id is None or self.provider is None:
            return
        from deerflow.sandbox.lease import get_sandbox_lease_manager

        owner_id = self.owner_id
        self.owner_id = None
        await get_sandbox_lease_manager(self.provider).release_async(owner_id)


async def try_acquire_sandbox_for_request(
    request: Request,
    sandbox_provider,
    thread_id: str,
    *,
    user_id: str,
    app_config: AppConfig | None,
    owner_prefix: str = "gateway",
    release_on_last: bool = True,
) -> SandboxRequestLease:
    """Gate + acquire the thread sandbox for a Gateway sync path.

    Single entry point for the uploads/artifacts sandbox-sync paths so the
    deny/skip semantics live in one place: runs the ``sandbox:execute`` gate
    for the request's user, then acquires the sandbox under a unique request
    holder. Callers must await :meth:`SandboxRequestLease.release` after their
    last client operation.

    - denied role → no sandbox/owner and ``denied=True``: acquisition was skipped by policy;
      the primary operation (upload / artifact edit) proceeds without the
      sandbox copy.
    - allowed → ``sandbox`` is the acquired instance, or ``sandbox is None`` when
      the provider lost it right after acquiring (infrastructure error —
      callers surface it as 500 / RuntimeError respectively, since that is
      not a policy decision).
    - ``request is None`` (direct-call tests) and unresolvable users skip the
      gate — same fail-open semantics as the models routes' anonymous bypass.
    """
    from deerflow.sandbox.exceptions import SandboxAuthorizationError

    try:
        from app.gateway.deps import get_optional_user_from_request

        user = await get_optional_user_from_request(request) if request is not None else None
        if user is not None:
            authorize_sandbox_for_request(
                user,
                is_internal=_is_internal_caller(request, user),
                app_config=app_config,
                authz_attributes=getattr(request.state, "iam_authz_attributes", None),
            )
    except SandboxAuthorizationError:
        logger.info("Sandbox sync skipped: sandbox execution not permitted for this caller (thread_id=%s)", thread_id)
        return SandboxRequestLease(
            sandbox=None,
            sandbox_id=None,
            denied=True,
            owner_id=None,
            provider=None,
        )

    from deerflow.sandbox.lease import get_sandbox_lease_manager

    owner_id = f"{owner_prefix}:{uuid.uuid4()}"
    sandbox_id = await get_sandbox_lease_manager(sandbox_provider).acquire_async(
        owner_id,
        thread_id,
        user_id=user_id,
        release_on_last=release_on_last,
    )
    return SandboxRequestLease(
        sandbox=sandbox_provider.get(sandbox_id),
        sandbox_id=sandbox_id,
        denied=False,
        owner_id=owner_id,
        provider=sandbox_provider,
    )


async def _authenticate(request: Request) -> AuthContext:
    """Authenticate request and return AuthContext.

    Delegates to deps.get_optional_user_from_request() for the JWT→User pipeline.
    Returns AuthContext with user=None for anonymous requests.
    """
    from app.gateway.deps import get_optional_user_from_request

    user = await get_optional_user_from_request(request)
    if user is None:
        return AuthContext(user=None, permissions=[])

    permissions = await resolve_route_permissions_for_request(request, user)
    return AuthContext(user=user, permissions=permissions)


def _is_internal_caller(request: Request, user: Any) -> bool:
    """Determine if the request originates from a trusted internal caller.

    Checks three signals (any one suffices):
    1. ``request.state.auth_source == AUTH_SOURCE_INTERNAL`` (set by AuthMiddleware).
    2. ``user.system_role == INTERNAL_SYSTEM_ROLE`` (synthetic internal user).
    3. The request carries a valid internal auth token header (decorator-only path
       where AuthMiddleware may not have stamped ``auth_source`` yet).
    """
    from app.gateway.auth_disabled import AUTH_SOURCE_INTERNAL
    from app.gateway.internal_auth import INTERNAL_AUTH_HEADER_NAME, INTERNAL_SYSTEM_ROLE, is_valid_internal_auth_token

    if getattr(getattr(request, "state", None), "auth_source", None) == AUTH_SOURCE_INTERNAL:
        return True
    if getattr(user, "system_role", None) == INTERNAL_SYSTEM_ROLE:
        return True
    # Decorator-only path: check the internal token header directly.
    internal_token = request.headers.get(INTERNAL_AUTH_HEADER_NAME) if hasattr(request, "headers") else None
    if internal_token and is_valid_internal_auth_token(internal_token):
        return True
    return False


def require_auth[**P, T](func: Callable[P, T]) -> Callable[P, T]:
    """Decorator that authenticates the request and enforces authentication.

    Independently raises HTTP 401 for unauthenticated requests, regardless of
    whether ``AuthMiddleware`` is present in the ASGI stack. Sets the resolved
    ``AuthContext`` on ``request.state.auth`` for downstream handlers.

    Must be placed ABOVE other decorators (executes after them).

    Usage:
        @router.get("/{thread_id}")
        @require_auth  # Bottom decorator (executes first after permission check)
        @require_permission("threads", "read")
        async def get_thread(thread_id: str, request: Request):
            auth: AuthContext = request.state.auth
            ...

    Raises:
        HTTPException: 401 if the request is unauthenticated.
        ValueError: If 'request' parameter is missing.
    """

    @functools.wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        request = kwargs.get("request")
        if request is None:
            # Unit tests may call decorated handlers directly without a
            # FastAPI Request object. Inject a minimal request stub when
            # the wrapped function declares `request`.
            if "request" in inspect.signature(func).parameters:
                kwargs["request"] = _make_test_request_stub()
            else:
                raise ValueError("require_auth decorator requires 'request' parameter")
            request = kwargs["request"]

        if getattr(request, "_deerflow_test_bypass_auth", False):
            return await func(*args, **kwargs)

        # Authenticate and set context
        auth_context = await _authenticate(request)
        request.state.auth = auth_context

        if not auth_context.is_authenticated:
            raise HTTPException(status_code=401, detail="Authentication required")

        return await func(*args, **kwargs)

    return wrapper


def require_permission(
    resource: str,
    action: str,
    owner_check: bool = False,
    require_existing: bool = False,
    request_parameter: str = "request",
) -> Callable[[Callable[P, T]], Callable[P, T]]:
    """Decorator that checks permission for resource:action.

    Must be used AFTER @require_auth.

    Args:
        resource: Resource name (e.g., "threads", "runs")
        action: Action name (e.g., "read", "write", "delete")
        owner_check: If True, validates that the current user owns the resource.
                     Requires 'thread_id' path parameter and performs ownership check.
        require_existing: Only meaningful with ``owner_check=True``. If True, a
                          missing ``threads_meta`` row counts as a denial (404)
                          instead of "untracked legacy thread, allow". Use on
                          **destructive / mutating** routes (DELETE, PATCH,
                          state-update) so a deleted thread can't be re-targeted
                          by another user via the missing-row code path.
        request_parameter: Name of the handler parameter carrying FastAPI's
                            Request when a legacy route calls it ``http_request``.

    Usage:
        # Read-style: legacy untracked threads are allowed
        @require_permission("threads", "read", owner_check=True)
        async def get_thread(thread_id: str, request: Request):
            ...

        # Destructive: thread row MUST exist and be owned by caller
        @require_permission("threads", "delete", owner_check=True, require_existing=True)
        async def delete_thread(thread_id: str, request: Request):
            ...

    Raises:
        HTTPException 401: If authentication required but user is anonymous
        HTTPException 403: If user lacks permission
        HTTPException 404: If owner_check=True but user doesn't own the thread
        ValueError: If owner_check=True but 'thread_id' parameter is missing
    """

    def decorator(func: Callable[P, T]) -> Callable[P, T]:
        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            request = kwargs.get(request_parameter)
            if request is None:
                # Unit tests may call decorated route handlers directly — with
                # or without constructing a FastAPI Request object — and may
                # pass ``request`` positionally. Bind to the real signature
                # first so a positional request is found rather than
                # duplicated by the stub injection below.
                try:
                    bound = inspect.signature(func).bind_partial(*args, **kwargs)
                except TypeError:
                    bound = None
                if bound is not None and request_parameter in bound.arguments:
                    request = bound.arguments[request_parameter]
                    if request is None and request_parameter in inspect.signature(func).parameters:
                        request = _make_test_request_stub()
                        bound.arguments[request_parameter] = request
                        args, kwargs = bound.args, bound.kwargs
                elif request_parameter in inspect.signature(func).parameters:
                    kwargs[request_parameter] = _make_test_request_stub()
                    request = kwargs[request_parameter]
                else:
                    return await func(*args, **kwargs)

            if getattr(request, "_deerflow_test_bypass_auth", False):
                return await func(*args, **kwargs)

            auth: AuthContext = getattr(request.state, "auth", None)
            if auth is None:
                auth = await _authenticate(request)
                request.state.auth = auth

            if not auth.is_authenticated:
                raise HTTPException(status_code=401, detail="Authentication required")

            # Check permission
            if not auth.has_permission(resource, action):
                raise HTTPException(
                    status_code=403,
                    detail=f"Permission denied: {resource}:{action}",
                )

            # Owner check for thread-specific resources.
            #
            # 2.0-rc moved thread metadata into the SQL persistence layer
            # (``threads_meta`` table). We verify ownership via
            # ``ThreadMetaStore.check_access``: it returns True for
            # missing rows (untracked legacy thread) and for rows whose
            # ``user_id`` is NULL (shared / pre-auth data), so this is
            # strict-deny rather than strict-allow — only an *existing*
            # row with a *different* user_id triggers 404.
            if owner_check:
                from app.gateway.internal_auth import INTERNAL_OWNER_USER_ID_HEADER_NAME, INTERNAL_SYSTEM_ROLE

                thread_id = kwargs.get("thread_id")
                if thread_id is None:
                    raise ValueError("require_permission with owner_check=True requires 'thread_id' parameter")

                from app.gateway.deps import get_thread_store

                thread_store = get_thread_store(request)
                allowed = await thread_store.check_access(
                    thread_id,
                    str(auth.user.id),
                    require_existing=require_existing,
                )
                if not allowed and getattr(auth.user, "system_role", None) == INTERNAL_SYSTEM_ROLE:
                    # Trusted internal callers (channel workers) also act for
                    # the connection owner carried in X-DeerFlow-Owner-User-Id.
                    # Scope the check to that owner instead of bypassing it; a
                    # leaked internal token must not grant cross-user thread
                    # access. The header is honored only after ``auth`` proved
                    # the caller holds the internal token (mirrors
                    # get_trusted_internal_owner_user_id, which keys off the
                    # middleware-stamped ``request.state.user``).
                    header_owner = (request.headers.get(INTERNAL_OWNER_USER_ID_HEADER_NAME) or "").strip()
                    if header_owner:
                        allowed = await thread_store.check_access(
                            thread_id,
                            header_owner,
                            require_existing=require_existing,
                        )
                if not allowed:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Thread {thread_id} not found",
                    )

            # 本地 owner 校验保护会话归属；中央 data_scope 也要覆盖按 ID
            # 读取和修改的线程/运行资源，否则用户可绕过列表入口访问被策略排除的行。
            if owner_check and action == "read" and resource in {"threads", "runs"}:
                # Read behavior is intentionally kept compatible with routes
                # that enumerate a thread's runs (there is no run ID there).
                await require_iam_data_scope_for_request(request, auth.user, target=f"{resource}:{action}")
            elif owner_check and ((resource == "threads" and action in {"write", "delete"}) or (resource == "runs" and action in {"create", "cancel"})):
                # A new run has no resource ID yet. Existing thread mutations
                # bind to thread_id; run cancellation binds to the run_id in
                # the route. The local owner check above still runs first.
                resource_id = None
                if resource == "threads":
                    resource_id = kwargs.get("thread_id")
                elif action == "cancel":
                    resource_id = kwargs.get("run_id")
                await require_iam_data_scope_for_request(
                    request,
                    auth.user,
                    target=f"{resource}:{action}",
                    action=action,
                    resource_id=str(resource_id) if resource_id is not None else None,
                )

            return await func(*args, **kwargs)

        return wrapper

    return decorator
