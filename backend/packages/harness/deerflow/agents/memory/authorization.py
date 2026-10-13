"""Central IAM data-scope checks for every per-user memory operation.

DeerFlow memory storage is keyed by its local user id, while Central IAM scopes
are keyed by the verified OIDC subject. This module requires both identities to
match the active Gateway runtime and accepts only an owner/self scope that can
be enforced by the existing local owner filter.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping, Sequence
from typing import Any

from deerflow.authz.principal import build_principal_from_context
from deerflow.authz.runtime import resolve_authorization_provider
from deerflow.config.app_config import get_app_config
from deerflow.config.authorization_config import AuthorizationConfig

logger = logging.getLogger(__name__)


def _uses_iam_identity(provider: Any) -> bool:
    return getattr(provider, "requires_iam_identity", False) is True or getattr(provider, "name", None) == "central-iam"


def _has_exact_owner_scope(scope: Any, *, subject: str, tenant_id: str) -> bool:
    if not isinstance(scope, Mapping) or scope.get("mode") != "any_of":
        return False
    constraints = scope.get("constraints")
    if not isinstance(constraints, list) or not constraints:
        return False
    # All branches must be enforceable by DeerFlow's local user_id filter.
    # Tenant and organization branches would expose rows this schema cannot
    # currently filter, so fail closed even if another branch is owner-only.
    for constraint in constraints:
        if (
            not isinstance(constraint, Mapping)
            or constraint.get("kind") != "owner"
            or constraint.get("field") != "owner_user_id"
            or constraint.get("user_id") != subject
            or not isinstance(constraint.get("tenant_id"), str)
            or constraint["tenant_id"].lower() != tenant_id.lower()
        ):
            return False
    return True


async def is_memory_scope_authorized(
    runtime_context: Mapping[str, Any] | None,
    *,
    local_user_id: str,
    actions: Sequence[str],
    authorization_config: AuthorizationConfig | None = None,
    provider: Any | None = None,
) -> bool:
    """Check Central IAM scopes before touching a user's memory.

    Authorization-disabled and non-IAM local providers retain their existing
    behavior. Once an IAM identity provider is configured, missing identity,
    missing permission mappings, provider errors, and broad scopes all deny.
    """
    try:
        scope_context = _resolve_scope_context(
            runtime_context,
            local_user_id=local_user_id,
            actions=actions,
            authorization_config=authorization_config,
            provider=provider,
        )
        if isinstance(scope_context, bool):
            return scope_context
        resolved_provider, principal, subject, tenant_id = scope_context
        checker = getattr(resolved_provider, "aresolve_data_scope", None)
        if not callable(checker):
            return False
        for action in actions:
            target = f"memory:{action}"
            decision = await checker(
                principal,
                resource="route",
                action=action,
                target=target,
                context={"route_target": target},
            )
            if not _decision_has_memory_scope(decision, subject=subject, tenant_id=tenant_id):
                return False
        return True
    except asyncio.CancelledError:
        raise
    except Exception:
        # Authorization failures must not expose IAM URLs, tokens, or provider
        # response bodies to tool output or user data.
        logger.warning("Central IAM memory data-scope check failed")
        return False


def is_memory_scope_authorized_sync(
    runtime_context: Mapping[str, Any] | None,
    *,
    local_user_id: str,
    actions: Sequence[str],
) -> bool:
    """Synchronous check for LangChain tools and sync graph hooks.

    Use the provider's synchronous data-scope method directly. This keeps the
    caller's run-scoped vault capability on its original event loop and avoids
    reusing an async database pool from a worker-created event loop.
    """
    try:
        scope_context = _resolve_scope_context(
            runtime_context,
            local_user_id=local_user_id,
            actions=actions,
            authorization_config=None,
            provider=None,
        )
        if isinstance(scope_context, bool):
            return scope_context
        resolved_provider, principal, subject, tenant_id = scope_context
        checker = getattr(resolved_provider, "resolve_data_scope", None)
        if not callable(checker):
            return False
        for action in actions:
            target = f"memory:{action}"
            decision = checker(
                principal,
                resource="route",
                action=action,
                target=target,
                context={"route_target": target},
            )
            if not _decision_has_memory_scope(decision, subject=subject, tenant_id=tenant_id):
                return False
        return True
    except Exception:
        logger.warning("Central IAM memory data-scope check failed")
        return False


def _resolve_scope_context(
    runtime_context: Mapping[str, Any] | None,
    *,
    local_user_id: str,
    actions: Sequence[str],
    authorization_config: AuthorizationConfig | None,
    provider: Any | None,
) -> tuple[Any, Any, str, str] | bool:
    """Resolve trusted policy inputs, returning bool for preserve/deny cases."""
    config = authorization_config or get_app_config().authorization
    if config.enabled is not True:
        return True
    resolved_provider = provider or resolve_authorization_provider(config)
    if not _uses_iam_identity(resolved_provider):
        return True
    if not isinstance(runtime_context, Mapping) or not actions:
        return False
    if any(action not in {"read", "write", "delete"} for action in actions):
        return False

    runtime_user_id = runtime_context.get("user_id")
    if not isinstance(local_user_id, str) or not local_user_id or not isinstance(runtime_user_id, str) or runtime_user_id != local_user_id:
        return False

    # Only the run-scoped capability injected by the Gateway principal builder
    # may carry IAM credentials. Never trust credential-shaped values copied
    # from a tool or serialized LangGraph context.
    principal_context = {
        "user_id": runtime_user_id,
        "user_role": runtime_context.get("user_role"),
        "oauth_provider": runtime_context.get("oauth_provider"),
        "oauth_id": runtime_context.get("oauth_id"),
        "channel_user_id": runtime_context.get("channel_user_id"),
        "is_internal": runtime_context.get("is_internal") is True,
        "authz_attributes": {},
    }
    principal = build_principal_from_context(principal_context, default_role=config.default_role)
    subject = principal.oauth_id
    credentials = principal.attributes.get("iam_credentials")
    if principal.is_internal or not isinstance(subject, str) or not subject or not isinstance(credentials, Mapping) or credentials.get("iam_subject") != subject:
        return False
    tenant_id = credentials.get("iam_tenant_id")
    if not isinstance(tenant_id, str) or not tenant_id:
        return False
    return resolved_provider, principal, subject, tenant_id


def _decision_has_memory_scope(decision: Any, *, subject: str, tenant_id: str) -> bool:
    if getattr(decision, "allow", False) is not True:
        return False
    metadata = getattr(decision, "metadata", None)
    scope = metadata.get("data_scope") if isinstance(metadata, Mapping) else None
    return _has_exact_owner_scope(scope, subject=subject, tenant_id=tenant_id)
