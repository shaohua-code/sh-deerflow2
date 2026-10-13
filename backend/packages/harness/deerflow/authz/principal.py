"""Principal builder — the single sanctioned way to construct a Principal.

Both Layer 1 (tool assembly) and Layer 2 (GuardrailAuthorizationAdapter) must
use this builder so identity semantics stay consistent. It is a pure function:
no global config reads, no caching, no input mutation.
"""

from __future__ import annotations

from collections.abc import Mapping
from contextvars import ContextVar, Token
from typing import Any

from deerflow.authz.provider import Principal

# A run-scoped capability is kept outside LangGraph's serializable context.
# Child asyncio tasks inherit it for the lifetime of the run; run_agent resets
# the binding before final cleanup so it cannot bleed into later work.
_RUN_AUTHORIZATION_CREDENTIALS: ContextVar[Mapping[str, Any] | None] = ContextVar(
    "deerflow_run_authorization_credentials",
    default=None,
)


def bind_run_authorization_credentials(credentials: Mapping[str, Any] | None) -> Token:
    """Bind a server-owned credential capability to the current agent run."""
    if credentials is not None and not isinstance(credentials, Mapping):
        raise TypeError("run authorization credentials must be a Mapping")
    return _RUN_AUTHORIZATION_CREDENTIALS.set(credentials)


def reset_run_authorization_credentials(token: Token) -> None:
    """Restore the previous capability binding after a run finishes."""
    _RUN_AUTHORIZATION_CREDENTIALS.reset(token)


def normalize_authz_attributes(raw: Any) -> dict[str, Any]:
    """Validate and copy ``authz_attributes`` into a fresh dict.

    This is the single normalization point shared by the Principal builder and
    all propagation sites (middleware, executor, task_tool). Keeping it in one
    place ensures every in-process consumption boundary raises ``TypeError``
    for non-Mapping values rather than silently coercing.

    Raises:
        TypeError: If *raw* is not ``None`` and not a ``Mapping``.
    """
    if raw is None:
        return {}
    if isinstance(raw, Mapping):
        return dict(raw)
    raise TypeError(f"authz_attributes must be a Mapping, got {type(raw).__name__}")


def build_principal_from_context(
    context: Mapping[str, Any],
    *,
    default_role: str,
) -> Principal:
    """Build a :class:`Principal` from a runtime context mapping.

    Args:
        context: The runtime context (``config["context"]`` or a dict assembled
            from a :class:`~deerflow.guardrails.provider.GuardrailRequest`).
        default_role: Role used when ``user_role`` is ``None`` or empty string.
            Unknown but non-empty roles are **not** replaced — only missing ones.

    Raises:
        TypeError: If ``authz_attributes`` is present but not a ``Mapping``.
    """
    resolved_role = context.get("user_role")
    if resolved_role is None or resolved_role == "":
        resolved_role = default_role

    attributes = normalize_authz_attributes(context.get("authz_attributes"))
    run_credentials = _RUN_AUTHORIZATION_CREDENTIALS.get()
    if run_credentials is not None:
        # Only attach the capability to the same OIDC subject that the Gateway
        # authenticated. A subagent or other context with another identity must
        # never inherit the caller's token as its own authorization identity.
        subject = context.get("oauth_id")
        for key in ("iam_credentials", "iam_access_token", "iam_subject", "iam_tenant_id"):
            # Do not let stale or caller-supplied credentials survive when a
            # run has an authoritative capability bound to another subject.
            attributes.pop(key, None)
        if isinstance(subject, str) and run_credentials.get("iam_subject") == subject:
            attributes["iam_credentials"] = run_credentials

    return Principal(
        user_id=context.get("user_id"),
        role=resolved_role,
        oauth_provider=context.get("oauth_provider"),
        oauth_id=context.get("oauth_id"),
        channel_user_id=context.get("channel_user_id"),
        is_internal=context.get("is_internal") is True,
        attributes=attributes,
    )
