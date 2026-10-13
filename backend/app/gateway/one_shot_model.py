"""Authorize and account for Gateway model calls outside an Agent run."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager

from fastapi import HTTPException, Request

from app.gateway.authz import (
    _AuthorizationUnavailable,
    _is_internal_caller,
    resolve_model_authorization,
)
from deerflow.authz.iam_model_usage import IamModelQuotaExceeded, IamModelUsageError
from deerflow.authz.iam_model_usage_callback import (
    bind_run_iam_model_usage_callback,
    build_iam_model_usage_callback,
    reset_run_iam_model_usage_callback,
)
from deerflow.authz.provider import AuthzRequest, is_authz_decision
from deerflow.config.app_config import AppConfig
from deerflow.utils.oneshot_llm import run_oneshot_llm

logger = logging.getLogger(__name__)


def _configured_model_name(app_config: AppConfig, requested_name: str | None) -> str:
    """Resolve the exact configured profile used by the Provider call."""
    model_name = requested_name
    if model_name is None:
        models = getattr(app_config, "models", None)
        model_name = getattr(models[0], "name", None) if models else None
    if not isinstance(model_name, str) or not model_name.strip():
        raise HTTPException(status_code=503, detail="No model is configured for this request")
    model_name = model_name.strip()
    get_model_config = getattr(app_config, "get_model_config", None)
    if not callable(get_model_config) or get_model_config(model_name) is None:
        raise HTTPException(status_code=404, detail="Model not found")
    return model_name


async def _authorize_model_invocation(
    request: Request,
    app_config: AppConfig,
    model_name: str,
) -> None:
    """Check the configured model profile before any Provider access."""
    auth = getattr(request.state, "auth", None)
    user = getattr(auth, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    fail_closed = getattr(getattr(app_config, "authorization", None), "fail_closed", True)
    try:
        provider, principal = resolve_model_authorization(
            user,
            is_internal=_is_internal_caller(request, user),
            authz_attributes=getattr(request.state, "iam_authz_attributes", None),
        )
    except _AuthorizationUnavailable:
        if fail_closed:
            raise HTTPException(status_code=503, detail="Model authorization is unavailable") from None
        return

    if provider is None or principal is None:
        return

    try:
        decision = await provider.aauthorize(
            AuthzRequest(
                principal=principal,
                resource="model",
                action="use",
                target=model_name,
            ),
        )
        if not is_authz_decision(decision):
            raise TypeError("AuthorizationProvider.aauthorize must return AuthzDecision")
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.warning("Model invocation authorization failed")
        if fail_closed:
            raise HTTPException(status_code=503, detail="Model authorization is unavailable") from None
        return

    if not decision.allow:
        raise HTTPException(status_code=403, detail="Model is not available for this account")


@asynccontextmanager
async def authorized_model_usage_scope(
    *,
    request: Request | None,
    app_config: AppConfig,
    model_name: str | None = None,
) -> AsyncIterator[str | None]:
    """Authorize a non-Agent model call and bind its IAM usage callback.

    The same scope is used by one-shot HTTP endpoints and Gateway operations
    that invoke a secondary model, such as the skill security moderator. It
    checks ``model:use`` before Provider access and keeps reserve/settle
    callbacks active for the whole operation.
    """
    callback = None
    callback_token = None
    resolved_model_name = model_name

    if request is not None:
        resolved_model_name = _configured_model_name(app_config, model_name)
        await _authorize_model_invocation(request, app_config, resolved_model_name)
        authz_attributes = getattr(request.state, "iam_authz_attributes", None)
        try:
            callback = build_iam_model_usage_callback(
                app_config,
                authz_attributes if isinstance(authz_attributes, Mapping) else None,
            )
        except Exception:
            logger.warning("Could not initialize IAM model usage accounting")
            raise HTTPException(status_code=503, detail="Model usage accounting is unavailable") from None
        if callback is not None:
            callback_token = bind_run_iam_model_usage_callback(callback)

    try:
        yield resolved_model_name
    except IamModelQuotaExceeded:
        raise HTTPException(status_code=429, detail="Model quota exceeded") from None
    except IamModelUsageError:
        raise HTTPException(status_code=503, detail="Model usage accounting is unavailable") from None
    finally:
        if callback_token is not None:
            reset_run_iam_model_usage_callback(callback_token)
        if callback is not None:
            try:
                await asyncio.to_thread(callback.close)
            except Exception as exc:
                logger.warning("IAM usage callback cleanup failed (%s)", type(exc).__name__)


async def run_authorized_one_shot_model(
    *,
    request: Request | None,
    system_instruction: str,
    user_content: str,
    run_name: str,
    app_config: AppConfig,
    model_name: str | None = None,
    thread_id: str | None = None,
) -> str:
    """Run a non-Agent model call with the same IAM checks and metering.

    Composer polishing and follow-up suggestions run outside LangGraph, so they
    do not inherit the Agent's model authorization or per-call usage callback.
    Bind a short-lived callback only after the request's configured model has
    passed ``model.invoke`` authorization. The capability is reset and closed
    in all cases, including cancellation and Provider errors.
    """
    async with authorized_model_usage_scope(request=request, app_config=app_config, model_name=model_name) as resolved_model_name:
        return await run_oneshot_llm(
            system_instruction=system_instruction,
            user_content=user_content,
            run_name=run_name,
            app_config=app_config,
            model_name=resolved_model_name,
            thread_id=thread_id,
        )
