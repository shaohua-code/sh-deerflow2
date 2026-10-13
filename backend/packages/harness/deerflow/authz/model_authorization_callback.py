"""Per-invocation authorization for configured DeerFlow chat models.

The Gateway binds a small, server-created identity projection to one run. Each
model profile created during that run gets this callback, which checks the
exact profile immediately before LangChain dispatches a provider request.
Vault capabilities stay in memory and never enter RunnableConfig or state.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Mapping
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

from deerflow.authz.principal import build_principal_from_context
from deerflow.authz.provider import AuthzRequest, is_authz_decision
from deerflow.authz.runtime import resolve_authorization_provider

logger = logging.getLogger(__name__)
_MAX_AUTHORIZATION_WAIT_SECONDS = 31.0


@dataclass(frozen=True, slots=True)
class _RunAuthorizationContext:
    """Trusted identifiers plus a server-owned, redacted vault capability."""

    principal_context: Mapping[str, Any]
    credentials: Mapping[str, Any] | None = field(default=None, repr=False, compare=False)
    loop: asyncio.AbstractEventLoop | None = field(default=None, repr=False, compare=False)

    def __repr__(self) -> str:
        return "_RunAuthorizationContext(principal_context=<redacted>, credentials=<redacted>)"


_RUN_MODEL_AUTHORIZATION_CONTEXT: ContextVar[_RunAuthorizationContext | None] = ContextVar(
    "deerflow_run_model_authorization_context",
    default=None,
)


def bind_run_model_authorization_context(
    runtime_context: Mapping[str, Any],
    credentials: Mapping[str, Any] | None,
) -> Token:
    """Bind only the Gateway-owned principal fields for one Agent run."""
    if not isinstance(runtime_context, Mapping):
        raise TypeError("runtime_context must be a Mapping")
    if credentials is not None and not isinstance(credentials, Mapping):
        raise TypeError("authorization credentials must be a Mapping")

    identity_keys = (
        "user_id",
        "user_role",
        "oauth_provider",
        "oauth_id",
        "channel_user_id",
        "is_internal",
        "thread_id",
        "run_id",
    )
    principal_context = {key: runtime_context[key] for key in identity_keys if key in runtime_context}
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    return _RUN_MODEL_AUTHORIZATION_CONTEXT.set(
        _RunAuthorizationContext(
            principal_context=principal_context,
            credentials=credentials,
            loop=loop,
        )
    )


def reset_run_model_authorization_context(token: Token) -> None:
    """Restore the previous model-authorization context after the run."""
    _RUN_MODEL_AUTHORIZATION_CONTEXT.reset(token)


def build_run_model_authorization_callback(
    app_config: Any,
    model_name: str,
) -> ModelAuthorizationCallback | None:
    """Bind one configured profile to the active Gateway run, when enabled."""
    authorization_config = getattr(app_config, "authorization", None)
    if getattr(authorization_config, "enabled", False) is not True:
        return None
    run_context = _RUN_MODEL_AUTHORIZATION_CONTEXT.get()
    if run_context is None:
        # Standalone Harness/library callers retain their own integration
        # boundary. Gateway workers bind this context before building models.
        return None
    return ModelAuthorizationCallback(
        model_name=model_name,
        authorization_config=authorization_config,
        run_context=run_context,
    )


class ModelAuthorizationCallback(BaseCallbackHandler):
    """Check ``model:use`` for the exact profile before each provider call."""

    raise_error = True
    run_inline = False

    def __init__(self, *, model_name: str, authorization_config: Any, run_context: _RunAuthorizationContext) -> None:
        if not isinstance(model_name, str) or not model_name.strip():
            raise ValueError("A configured model profile name is required")
        self._model_name = model_name.strip()
        self._authorization_config = authorization_config
        self._run_context = run_context
        self._provider: Any | None = None
        self._provider_error = False
        self._provider_lock = threading.Lock()

    def __repr__(self) -> str:
        return "ModelAuthorizationCallback(model=<configured>, credentials=<redacted>)"

    def on_chat_model_start(self, _serialized: dict[str, Any], _messages: list[list[Any]], **_kwargs: Any) -> None:
        self._authorize_before_dispatch()

    def on_llm_start(self, _serialized: dict[str, Any], _prompts: list[str], **_kwargs: Any) -> None:
        self._authorize_before_dispatch()

    def _authorize_before_dispatch(self) -> None:
        provider = self._get_provider()
        if provider is None:
            self._provider_failure("authorization provider is unavailable")
            return

        principal_context = dict(self._run_context.principal_context)
        attributes: dict[str, Any] = {}
        # Discard anything that might look like request-supplied IAM credential
        # data. Only the Gateway-bound capability below can reach the provider.
        raw_attributes = principal_context.get("authz_attributes")
        if isinstance(raw_attributes, Mapping):
            attributes = {key: value for key, value in raw_attributes.items() if key not in {"iam_credentials", "iam_access_token", "iam_subject", "iam_tenant_id"}}
        credentials = self._run_context.credentials
        subject = principal_context.get("oauth_id")
        credential_subject = credentials.get("iam_subject") if isinstance(credentials, Mapping) else None
        if credentials is not None and isinstance(subject, str) and credential_subject == subject:
            attributes["iam_credentials"] = credentials
        principal_context["authz_attributes"] = attributes
        principal = build_principal_from_context(
            principal_context,
            default_role=self._authorization_config.default_role,
        )
        request = AuthzRequest(
            principal=principal,
            resource="model",
            action="use",
            target=self._model_name,
            context={key: self._run_context.principal_context[key] for key in ("thread_id", "run_id") if key in self._run_context.principal_context},
        )

        try:
            loop = self._run_context.loop
            if loop is not None and loop.is_running():
                try:
                    running_loop = asyncio.get_running_loop()
                except RuntimeError:
                    running_loop = None
                if running_loop is not loop:
                    future = asyncio.run_coroutine_threadsafe(provider.aauthorize(request), loop)
                    decision = future.result(timeout=_MAX_AUTHORIZATION_WAIT_SECONDS)
                else:
                    # LangChain runs synchronous handlers off-loop. If a custom
                    # handler dispatches inline, the provider's sync contract is
                    # used to avoid blocking the loop on itself with a future.
                    decision = provider.authorize(request)
            else:
                decision = provider.authorize(request)
            if not is_authz_decision(decision):
                raise TypeError("authorization provider returned an invalid decision")
        except Exception as exc:
            self._provider_failure(type(exc).__name__)
            return

        if not decision.allow:
            logger.info("Central model authorization denied a configured profile")
            raise PermissionError("The current user is not authorized to use this model")

    def _get_provider(self) -> Any | None:
        with self._provider_lock:
            if self._provider is not None:
                return self._provider
            if self._provider_error:
                return None
            try:
                self._provider = resolve_authorization_provider(self._authorization_config)
            except Exception:
                self._provider_error = True
                return None
            return self._provider

    def _provider_failure(self, reason: str) -> None:
        if self._authorization_config.fail_closed is True:
            logger.warning("Model authorization failed closed (%s)", reason)
            raise PermissionError("Model authorization is unavailable") from None
        logger.warning("Model authorization provider failed; configured fail-open policy permits the call (%s)", reason)
