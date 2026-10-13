"""Commit-time authorization for the in-process memory update worker.

The memory queue runs on a synchronous timer thread, while Gateway auth and
the encrypted IAM token vault use async database sessions owned by the serving
event loop. This bridge submits a fresh authorization operation to that loop;
it never copies a request token or an authorization capability into the
queue. Only the already-scoped local identifiers cross the thread boundary.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from asyncio import AbstractEventLoop
from collections.abc import Mapping
from concurrent.futures import Future
from types import SimpleNamespace
from typing import Any

logger = logging.getLogger(__name__)

_loop_lock = threading.Lock()
_authorization_loop: AbstractEventLoop | None = None
_AUTHORIZATION_TIMEOUT_SECONDS = 30.0


def set_memory_authorization_loop(loop: AbstractEventLoop) -> None:
    """Bind authorization calls to the active Gateway lifespan loop."""
    global _authorization_loop
    with _loop_lock:
        _authorization_loop = loop


def reset_memory_authorization_loop(expected_loop: AbstractEventLoop) -> None:
    """Clear the loop only when it is still the one this lifespan installed."""
    global _authorization_loop
    with _loop_lock:
        if _authorization_loop is expected_loop:
            _authorization_loop = None


def authorize_memory_write(*, user_id: str | None, thread_id: str | None, agent_name: str | None) -> bool:
    """Synchronously reauthorize a memory update immediately before commit.

    The update queue is process-local and synchronous. When Central IAM is
    active, the worker must not use the run's possibly revoked or expired
    credential capability; it asks the serving loop to reload the active
    account and token-vault session. A bounded wait and every failure deny the
    write. Authorization-disabled standalone/local deployments preserve their
    existing behavior.
    """
    del thread_id, agent_name  # scope enforcement is currently user-owned only
    if not isinstance(user_id, str) or not user_id:
        return False

    try:
        from app.gateway.authz import _get_cached_route_provider, _get_route_authorization_config

        config = _get_route_authorization_config()
        if config.enabled is not True:
            return True
        provider = _get_cached_route_provider(config)
        if provider is not None and not _uses_iam_identity(provider):
            # Local RBAC is checked at queue admission. This second-stage bridge
            # exists to refresh server-side Central IAM grants and data scopes.
            return True
    except Exception:
        logger.warning("Could not resolve authorization provider before memory commit")
        return False

    with _loop_lock:
        loop = _authorization_loop
    if loop is None or loop.is_closed() or not loop.is_running():
        logger.warning("Gateway authorization loop is unavailable; skipping memory persistence")
        return False
    try:
        if asyncio.get_running_loop() is loop:
            # Blocking the serving loop waiting on itself would deadlock. The
            # updater is expected to run on its timer/worker thread instead.
            logger.warning("Memory persistence attempted on the Gateway event loop; skipping")
            return False
    except RuntimeError:
        pass

    future: Future[bool] = asyncio.run_coroutine_threadsafe(_authorize_memory_write(user_id), loop)
    try:
        return future.result(timeout=_AUTHORIZATION_TIMEOUT_SECONDS) is True
    except Exception:
        future.cancel()
        logger.warning("Central IAM memory authorization failed or timed out; skipping persistence")
        return False


def authorize_memory_model_use(*, user_id: str | None, model_name: str | None) -> bool:
    """Check memory read/write scopes and model:use before background dispatch.

    DeerMem's updater runs on a synchronous debounce thread and may construct
    its model outside DeerFlow's shared model factory. Only the local owner ID
    and the configured profile name cross this bridge; the Gateway loop reloads
    the active account and vault session before asking IAM.
    """
    if not isinstance(user_id, str) or not user_id or (model_name is not None and not isinstance(model_name, str)):
        return False

    try:
        from app.gateway.authz import _get_cached_route_provider, _get_route_authorization_config

        config = _get_route_authorization_config()
        if config.enabled is not True:
            return True
        provider = _get_cached_route_provider(config)
        if provider is None:
            return False
    except Exception:
        logger.warning("Could not resolve authorization provider before memory model dispatch")
        return False

    with _loop_lock:
        loop = _authorization_loop
    if loop is None or loop.is_closed() or not loop.is_running():
        logger.warning("Gateway authorization loop is unavailable; skipping memory model dispatch")
        return False
    try:
        if asyncio.get_running_loop() is loop:
            logger.warning("Memory model dispatch attempted on the Gateway event loop; skipping")
            return False
    except RuntimeError:
        pass

    future: Future[bool] = asyncio.run_coroutine_threadsafe(
        _authorize_memory_model_use(user_id, model_name),
        loop,
    )
    try:
        return future.result(timeout=_AUTHORIZATION_TIMEOUT_SECONDS) is True
    except Exception:
        future.cancel()
        logger.warning("Memory model authorization failed or timed out; skipping provider dispatch")
        return False


def create_memory_model_usage_callback(*, user_id: str | None, model_name: str | None) -> Any | None:
    """Build a one-call usage handler from the active vault at dispatch time.

    The memory debounce queue intentionally stores only local IDs. This sync
    bridge reloads the active user/vault on the Gateway loop and returns a
    callback with a short-lived capability; the caller closes it immediately
    after LangChain reports the memory-model result.
    """
    if not isinstance(user_id, str) or not user_id or (model_name is not None and not isinstance(model_name, str)):
        raise RuntimeError("Central IAM model usage admission is unavailable")

    try:
        from deerflow.config.app_config import get_app_config

        app_config = get_app_config()
        authorization = app_config.authorization
        provider = getattr(authorization, "provider", None)
        if getattr(provider, "use", None) != "deerflow.authz.iam_deerflow:DeerFlowIamAuthorizationProvider":
            return None
        provider_config = getattr(provider, "config", None)
        usage_config = provider_config.get("model_usage") if isinstance(provider_config, Mapping) else None
        if not isinstance(usage_config, Mapping) or usage_config.get("enabled") is not True:
            return None
        if authorization.enabled is not True:
            raise RuntimeError("Central IAM authorization must be enabled before model usage metering")
    except RuntimeError:
        raise
    except Exception:
        logger.warning("Could not resolve IAM usage configuration for memory model dispatch")
        raise RuntimeError("Central IAM model usage admission is unavailable") from None

    with _loop_lock:
        loop = _authorization_loop
    if loop is None or loop.is_closed() or not loop.is_running():
        logger.warning("Gateway authorization loop is unavailable; memory model usage cannot be admitted")
        raise RuntimeError("Central IAM model usage admission is unavailable")
    try:
        running_loop = asyncio.get_running_loop()
    except RuntimeError:
        # The debounce worker runs outside an event loop and can bridge to the
        # Gateway loop with run_coroutine_threadsafe below.
        running_loop = None
    if running_loop is loop:
        logger.warning("Memory model usage admission attempted on the Gateway event loop")
        raise RuntimeError("Central IAM model usage admission is unavailable")

    future = asyncio.run_coroutine_threadsafe(
        _build_memory_model_usage_callback(user_id, model_name),
        loop,
    )
    try:
        return future.result(timeout=_AUTHORIZATION_TIMEOUT_SECONDS)
    except Exception:
        future.cancel()
        logger.warning("Active IAM vault session could not admit memory model usage")
        raise RuntimeError("Central IAM model usage admission is unavailable") from None


async def _build_memory_model_usage_callback(user_id: str, model_name: str | None) -> Any:
    """Resolve the active vault without storing it in the memory queue."""
    try:
        from app.gateway.auth.iam_token_vault import load_active_iam_authorization_attributes
        from app.gateway.deps import get_local_provider
        from app.gateway.routers.auth import _get_oidc_service
        from deerflow.authz.iam_model_usage_callback import build_iam_model_usage_callback
        from deerflow.config.app_config import get_app_config

        user = await get_local_provider().get_user(user_id)
        if user is None or str(getattr(user, "id", "")) != user_id or not getattr(user, "is_active", False):
            raise RuntimeError("An active IAM session is required for memory model usage")
        app_config = get_app_config()
        authz_attributes = await load_active_iam_authorization_attributes(
            user=user,
            provider_configs=app_config.auth.oidc.providers,
            oidc_service=_get_oidc_service(),
        )
        credentials = authz_attributes.get("iam_credentials")
        if not isinstance(credentials, Mapping):
            raise RuntimeError("An active IAM session is required for memory model usage")

        profile_name = model_name.strip() if isinstance(model_name, str) else ""
        if not profile_name and app_config.models:
            profile_name = app_config.models[0].name
        if not profile_name:
            raise RuntimeError("A configured IAM model profile is required for memory model usage")

        callback = build_iam_model_usage_callback(app_config, credentials)
        if callback is None:
            raise RuntimeError("IAM model usage callback is not configured")
        return callback.for_model(profile_name)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.warning("Active IAM vault session could not admit memory model usage")
        raise RuntimeError("Central IAM model usage admission is unavailable") from None


def _uses_iam_identity(provider: Any) -> bool:
    return getattr(provider, "requires_iam_identity", False) is True or getattr(provider, "name", None) == "central-iam"


async def _authorize_memory_write(user_id: str) -> bool:
    """Reload current local/OIDC identity and require exact read+write scopes."""
    try:
        from app.gateway.auth.iam_token_vault import load_active_iam_authorization_attributes
        from app.gateway.authz import (
            _get_cached_route_provider,
            _get_route_authorization_config,
            require_iam_data_scope_for_request,
        )
        from app.gateway.deps import get_local_provider
        from app.gateway.routers.auth import _get_oidc_service
        from deerflow.config.app_config import get_app_config

        config = _get_route_authorization_config()
        if config.enabled is not True:
            return True
        provider = _get_cached_route_provider(config)
        if provider is None or not _uses_iam_identity(provider):
            return provider is not None

        user = await get_local_provider().get_user(user_id)
        if user is None or str(getattr(user, "id", "")) != user_id or not getattr(user, "is_active", False):
            return False

        app_config = get_app_config()
        authz_attributes = await load_active_iam_authorization_attributes(
            user=user,
            provider_configs=app_config.auth.oidc.providers,
            oidc_service=_get_oidc_service(),
        )
        credentials = authz_attributes.get("iam_credentials")
        if credentials is None:
            return False

        # Reuse the Gateway's central data-scope guard, which also verifies the
        # OIDC subject against the local account and rejects tenant/org scopes
        # DeerFlow's user_id-only memory storage cannot enforce.
        request = SimpleNamespace(
            state=SimpleNamespace(iam_authz_attributes=authz_attributes),
            headers={},
        )
        await require_iam_data_scope_for_request(request, user, target="memory:read", action="read")
        await require_iam_data_scope_for_request(request, user, target="memory:write", action="write")
        return True
    except asyncio.CancelledError:
        raise
    except Exception:
        # Do not log provider URLs, token data, or exception messages here.
        logger.warning("Central IAM denied or could not verify the memory write")
        return False


async def _authorize_memory_model_use(user_id: str, model_name: str | None) -> bool:
    """Reload the user and enforce memory scopes plus exact model permission."""
    try:
        from app.gateway.auth.iam_token_vault import load_active_iam_authorization_attributes
        from app.gateway.authz import (
            _get_cached_route_provider,
            require_iam_data_scope_for_request,
            resolve_model_authorization,
        )
        from app.gateway.deps import get_local_provider
        from app.gateway.routers.auth import _get_oidc_service
        from deerflow.authz.provider import AuthzRequest, is_authz_decision
        from deerflow.config.app_config import get_app_config

        user = await get_local_provider().get_user(user_id)
        if user is None or str(getattr(user, "id", "")) != user_id or not getattr(user, "is_active", False):
            return False

        app_config = get_app_config()
        resolved_model_name = model_name.strip() if isinstance(model_name, str) else ""
        if not resolved_model_name and app_config.models:
            # DeerMem's zero-config host_llm uses the same first profile as
            # create_chat_model(name=None); authorize that trusted profile.
            resolved_model_name = app_config.models[0].name
        if not resolved_model_name:
            return False

        configured_provider = _get_cached_route_provider(app_config.authorization)
        if configured_provider is None:
            return False
        authz_attributes: dict[str, Any] = {}
        if _uses_iam_identity(configured_provider):
            authz_attributes = await load_active_iam_authorization_attributes(
                user=user,
                provider_configs=app_config.auth.oidc.providers,
                oidc_service=_get_oidc_service(),
            )
            if authz_attributes.get("iam_credentials") is None:
                return False

        authorization_provider, principal = resolve_model_authorization(
            user,
            is_internal=False,
            authz_attributes=authz_attributes,
        )
        if authorization_provider is None or principal is None:
            return app_config.authorization.enabled is not True

        if _uses_iam_identity(authorization_provider):
            request = SimpleNamespace(
                state=SimpleNamespace(iam_authz_attributes=authz_attributes),
                headers={},
            )
            await require_iam_data_scope_for_request(request, user, target="memory:read", action="read")
            await require_iam_data_scope_for_request(request, user, target="memory:write", action="write")

        decision = await authorization_provider.aauthorize(
            AuthzRequest(
                principal=principal,
                resource="model",
                action="use",
                target=resolved_model_name,
            )
        )
        return is_authz_decision(decision) and decision.allow
    except asyncio.CancelledError:
        raise
    except Exception:
        # Keep vault, provider, model, and policy details out of logs. A denied
        # update must never transmit the conversation to a model provider.
        logger.warning("Central IAM denied or could not verify the memory model call")
        return False
