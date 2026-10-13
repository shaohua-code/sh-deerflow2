"""Fresh Gateway authorization for durable owner-data jobs.

Data jobs can wait in a database queue after the creating HTTP request ends.
This adapter resolves the active local account and current route/IAM policy at
each worker boundary; it never stores session tokens or authorization results.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from types import SimpleNamespace
from typing import Any

from deerflow_extension_api import OwnerDataAuthorizationError, OwnerDataScope
from fastapi import HTTPException

from deerflow.authz.principal import build_principal_from_context
from deerflow.authz.provider import AuthzRequest, is_authz_decision

logger = logging.getLogger(__name__)


class GatewayOwnerDataAuthorizer:
    """Recheck route grants and owner/self data scopes for one user operation."""

    async def authorize(self, *, user_id: str, scopes: Sequence[OwnerDataScope]) -> None:
        if not isinstance(user_id, str) or not user_id or not scopes:
            raise OwnerDataAuthorizationError(503, "Owner-data authorization is unavailable")

        from app.gateway.auth_disabled import AUTH_SOURCE_SESSION
        from app.gateway.authz import (
            _get_cached_route_provider,
            _get_route_authorization_config,
            require_iam_data_scope_for_request,
        )
        from app.gateway.deps import get_local_provider

        user = await get_local_provider().get_user(user_id)
        if user is None or not getattr(user, "is_active", False):
            raise OwnerDataAuthorizationError(403, "Owner-data access is unavailable for this account")

        config = _get_route_authorization_config()
        provider = None
        if config.enabled is True:
            try:
                provider = _get_cached_route_provider(config)
            except Exception:
                logger.warning("Could not resolve authorization provider for owner-data worker")
                raise OwnerDataAuthorizationError(503, "Owner-data authorization is unavailable") from None
            if provider is None:
                raise OwnerDataAuthorizationError(503, "Owner-data authorization is unavailable")

        authz_attributes: dict[str, Any] = {}
        central_iam = provider is not None and (getattr(provider, "requires_iam_identity", False) is True or getattr(provider, "name", None) == "central-iam")
        if central_iam:
            try:
                from app.gateway.auth.iam_token_vault import load_active_iam_authorization_attributes
                from app.gateway.routers.auth import _get_oidc_service
                from deerflow.config.app_config import get_app_config

                authz_attributes = await load_active_iam_authorization_attributes(
                    user=user,
                    provider_configs=get_app_config().auth.oidc.providers,
                    oidc_service=_get_oidc_service(),
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Could not refresh the active IAM vault session for owner-data worker")
                raise OwnerDataAuthorizationError(503, "Owner-data authorization is unavailable") from None
            if authz_attributes.get("iam_credentials") is None:
                raise OwnerDataAuthorizationError(403, "An active IAM session is required for this data job")

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
                "is_internal": False,
                "authz_attributes": authz_attributes,
            },
            default_role=config.default_role,
        )

        permissions: list[str] = []
        for scope in scopes:
            if not isinstance(scope, OwnerDataScope) or not scope.target or not scope.action:
                raise OwnerDataAuthorizationError(503, "Owner-data authorization is unavailable")
            if provider is not None:
                try:
                    decision = await provider.aauthorize(
                        AuthzRequest(
                            principal=principal,
                            resource="route",
                            action=scope.action,
                            target=scope.target,
                        )
                    )
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.warning("Current route authorization failed for owner-data worker")
                    raise OwnerDataAuthorizationError(503, "Owner-data authorization is unavailable") from None
                if not is_authz_decision(decision):
                    raise OwnerDataAuthorizationError(503, "Owner-data authorization is unavailable")
                if decision.allow is not True:
                    raise OwnerDataAuthorizationError(403, "Current route permission is required for this data job")
            permissions.append(scope.target)

        synthetic_request = SimpleNamespace(
            state=SimpleNamespace(
                user=user,
                auth=SimpleNamespace(user=user, permissions=permissions),
                auth_source=AUTH_SOURCE_SESSION,
                iam_authz_attributes=authz_attributes,
            ),
            headers={},
        )
        for scope in scopes:
            try:
                await require_iam_data_scope_for_request(
                    synthetic_request,
                    user,
                    target=scope.target,
                    action=scope.action,
                    resource_id=scope.resource_id,
                )
            except asyncio.CancelledError:
                raise
            except HTTPException as exc:
                status_code = exc.status_code if exc.status_code in {403, 503} else 503
                detail = exc.detail if isinstance(exc.detail, str) else "Owner-data authorization is unavailable"
                raise OwnerDataAuthorizationError(status_code, detail) from None
            except Exception:
                logger.warning("Current data-scope authorization failed for owner-data worker")
                raise OwnerDataAuthorizationError(503, "Owner-data authorization is unavailable") from None
