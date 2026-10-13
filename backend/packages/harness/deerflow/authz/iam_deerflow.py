"""DeerFlow AuthorizationProvider adapter for the central IAM service.

This module deliberately accepts IAM credentials only from server-owned
principal attributes. It does not read request JSON, cookies, or headers, and
it does not cache allow decisions: IAM revocation must take effect on the next
authorization check.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any
from uuid import UUID

from deerflow.authz.iam_authorization import IamAuthorizationClient


@dataclass(frozen=True)
class _Reason:
    code: str
    message: str = ""


@dataclass(frozen=True)
class _Decision:
    # Structural equivalent of deerflow.authz.provider.AuthzDecision. Keeping
    # this SDK module optional avoids making the base IAM client depend on DeerFlow.
    allow: bool
    reasons: list[_Reason] = field(default_factory=list)
    policy_id: str | None = "central-iam"
    metadata: dict[str, Any] = field(default_factory=dict)


class DeerFlowIamAuthorizationProvider:
    """Map DeerFlow resource checks to online IAM permission-code decisions.

    ``permission_map`` keys have the form ``resource:action`` or
    ``resource:action:target``. Exact target mappings take precedence over the
    resource/action mapping. Missing mappings always deny.

    The Gateway must populate ``principal.attributes`` from its verified,
    server-side OIDC session. It may provide the three IAM values directly for
    compatibility, or under ``iam_credentials`` as a redacted Mapping that
    keeps access-token values out of ordinary Principal/Request repr output.
    ``iam_subject`` must equal the OIDC ``oauth_id`` on the same principal. A
    browser-provided value is never a valid source.
    """

    name = "central-iam"
    requires_iam_identity = True

    def __init__(
        self,
        *,
        api_base_url: str,
        application_id: str,
        permission_map: Mapping[str, str],
        oidc_provider: str | None = None,
        filter_actions: Mapping[str, str] | None = None,
        model_resource_ids: Mapping[str, str] | None = None,
        resource_id_resolver: Callable[[Any], str] | None = None,
        timeout_seconds: float = 3.0,
    ) -> None:
        if not isinstance(api_base_url, str) or not api_base_url.strip():
            raise ValueError("api_base_url is required")
        if not isinstance(application_id, str) or not application_id.strip():
            raise ValueError("application_id is required")
        if not isinstance(permission_map, Mapping):
            raise ValueError("permission_map must be a mapping")
        if resource_id_resolver is not None and not callable(resource_id_resolver):
            raise ValueError("resource_id_resolver must be callable")
        if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, int | float) or not 0 < timeout_seconds <= 30:
            raise ValueError("timeout_seconds must be between 0 and 30")

        self.api_base_url = api_base_url.strip().rstrip("/")
        self.application_id = application_id.strip()
        self.oidc_provider = oidc_provider.strip() if isinstance(oidc_provider, str) and oidc_provider.strip() else None
        self.permission_map = self._validate_map(permission_map, "permission_map")
        self.filter_actions = self._validate_map(filter_actions or {}, "filter_actions")
        self.model_resource_ids = self._validate_model_resource_ids({} if model_resource_ids is None else model_resource_ids)
        self.resource_id_resolver = resource_id_resolver
        self.client = IamAuthorizationClient(
            self.api_base_url,
            application_id=self.application_id,
            timeout_seconds=float(timeout_seconds),
        )

    @staticmethod
    def _validate_map(values: Mapping[str, str], name: str) -> dict[str, str]:
        result: dict[str, str] = {}
        for key, value in values.items():
            if not isinstance(key, str) or not key.strip() or not isinstance(value, str) or not value.strip():
                raise ValueError(f"{name} keys and values must be non-empty strings")
            result[key.strip()] = value.strip()
        return result

    @staticmethod
    def _validate_model_resource_ids(values: Mapping[str, str]) -> dict[str, str]:
        """Validate the trusted DeerFlow model-name to IAM model-UUID map.

        Model names are local Gateway identifiers; IAM's ``model.invoke``
        authorization requires the UUID of the active tenant model record.
        Keeping this mapping in server configuration prevents browser/model
        request data from choosing the IAM resource being authorized.
        """
        if not isinstance(values, Mapping):
            raise ValueError("model_resource_ids must be a mapping")
        result: dict[str, str] = {}
        for model_name, raw_id in values.items():
            if not isinstance(model_name, str) or not model_name.strip() or not isinstance(raw_id, str) or not raw_id.strip():
                raise ValueError("model_resource_ids keys and values must be non-empty strings")
            try:
                model_id = str(UUID(raw_id.strip()))
            except (ValueError, AttributeError) as exc:
                raise ValueError("model_resource_ids values must be IAM model UUIDs") from exc
            result[model_name.strip()] = model_id
        return result

    def _permission_for(self, request: Any) -> str | None:
        resource = getattr(request, "resource", None)
        action = getattr(request, "action", None)
        target = getattr(request, "target", None)
        if not all(isinstance(value, str) and value for value in (resource, action, target)):
            return None
        return self.permission_map.get(f"{resource}:{action}:{target}") or self.permission_map.get(f"{resource}:{action}")

    def _resource_id_for(self, request: Any) -> str | None:
        """Resolve an optional IAM resource id from trusted server-side request data.

        The callback is application code, not user input. Once configured it
        must return a resource id for every mapped request; returning an empty,
        malformed, or oversized value raises so the caller can deny instead of
        silently falling back to a broader application-level grant.
        """
        if self.resource_id_resolver is not None:
            resource_id = self.resource_id_resolver(request)
        elif getattr(request, "resource", None) == "model" and self._permission_for(request) == "model.invoke":
            target = getattr(request, "target", None)
            resource_id = self.model_resource_ids.get(target) if isinstance(target, str) else None
            if resource_id is None:
                # An unmapped model must not fall back to a tenant-wide grant:
                # IAM checks ``model.invoke`` against a concrete catalog row.
                raise ValueError("no IAM model UUID is configured for this model")
        elif getattr(request, "resource", None) == "tool":
            # Tool names come from the server-built tool registry. Passing the
            # name as resource_id lets IAM grant a role one tool without
            # widening access to every tool in the DeerFlow application.
            resource_id = getattr(request, "target", None)
        else:
            return None
        if not isinstance(resource_id, str) or not resource_id.strip() or len(resource_id.strip()) > 180 or "\x00" in resource_id:
            raise ValueError("resource_id_resolver returned an invalid IAM resource id")
        return resource_id.strip()

    def resolve_data_scope(
        self,
        principal: Any,
        *,
        resource: str,
        action: str,
        target: str,
        context: Mapping[str, Any] | None = None,
    ) -> _Decision:
        """通过 IAM 查询当前主体的行级数据范围，并保留服务端校验结果。

        该方法只返回 IAM 已验证的范围，不会自动过滤业务数据。调用方必须把
        `metadata.data_scope` 编译成参数化查询条件，并在每个读写入口执行；
        缺少权限映射、可信主体、范围或 IAM 服务时一律拒绝。可选 context
        必须由业务服务端构造，resource_id_resolver 只能从可信字段解析资源 ID。
        """
        if context is not None and not isinstance(context, Mapping):
            return self._deny("iam_resource_context_invalid", "A valid server-side IAM resource context is required.")
        request = SimpleNamespace(
            principal=principal,
            resource=resource,
            action=action,
            target=target,
            context=dict(context) if context is not None else {},
        )
        permission_code = self._permission_for(request)
        if permission_code is None:
            return self._deny("iam_permission_unmapped", "No IAM permission mapping exists for this resource action.")

        identity = self._verified_identity(principal)
        if identity is None:
            return self._deny("iam_identity_unavailable", "A verified end-user IAM session is required.")
        access_token, subject, tenant_id = identity

        try:
            resource_id = self._resource_id_for(request)
        except Exception:
            return self._deny("iam_resource_context_invalid", "A valid server-side IAM resource id is required.")

        try:
            check_arguments: dict[str, Any] = {
                "access_token": access_token,
                "tenant_id": tenant_id,
                "permission_code": permission_code,
                "include_data_scope": True,
                "subject_id": subject,
            }
            if resource_id is not None:
                check_arguments["resource_id"] = resource_id
            decision = self.client.check(
                **check_arguments,
            )
        except Exception:
            # 不把令牌、IAM 地址、网络异常或数据库信息带回产品调用方。
            return self._deny("iam_unavailable", "Central IAM could not complete the data-scope check.")

        if decision.application_id != self.application_id:
            return self._deny(
                "iam_application_mismatch",
                "Central IAM did not confirm the configured application context.",
            )
        if not decision.allowed:
            return self._deny("iam_permission_denied", "Central IAM denied this data-scope permission.")
        data_scope = decision.data_scope
        if not isinstance(data_scope, Mapping) or data_scope.get("mode") != "any_of":
            return self._deny("iam_data_scope_missing", "Central IAM did not return a usable data scope.")
        constraints = data_scope.get("constraints")
        if not isinstance(constraints, list) or not constraints:
            return self._deny("iam_data_scope_missing", "Central IAM did not return a usable data scope.")

        return _Decision(
            allow=True,
            reasons=[_Reason("iam_data_scope_allowed", "Central IAM returned an authorized data scope.")],
            metadata={
                "permission_code": permission_code,
                "application_id": self.application_id,
                "data_scope": dict(data_scope),
            },
        )

    async def aresolve_data_scope(
        self,
        principal: Any,
        *,
        resource: str,
        action: str,
        target: str,
        context: Mapping[str, Any] | None = None,
    ) -> _Decision:
        """异步查询数据范围；Agent run 的 vault capability 先复核并刷新凭证。"""
        attributes = getattr(principal, "attributes", None)
        credential_context = attributes.get("iam_credentials") if isinstance(attributes, Mapping) else None
        refresh_if_needed = getattr(credential_context, "refresh_if_needed", None)
        if callable(refresh_if_needed):
            try:
                await refresh_if_needed()
            except Exception:
                return self._deny("iam_unavailable", "Central IAM could not complete the data-scope check.")
        return await asyncio.to_thread(
            self.resolve_data_scope,
            principal,
            resource=resource,
            action=action,
            target=target,
            context=context,
        )

    def _verified_identity(self, principal: Any) -> tuple[str, str, str] | None:
        """仅从 Gateway 投影的当前 Principal 读取服务端 vault 身份。"""
        attributes = getattr(principal, "attributes", None)
        if getattr(principal, "is_internal", False) is True or not isinstance(attributes, Mapping):
            return None
        credential_context = attributes.get("iam_credentials")
        credential_attributes = credential_context if isinstance(credential_context, Mapping) else attributes
        access_token = credential_attributes.get("iam_access_token")
        subject = credential_attributes.get("iam_subject")
        tenant_id = credential_attributes.get("iam_tenant_id")
        principal_subject = getattr(principal, "oauth_id", None)
        provider = getattr(principal, "oauth_provider", None)
        if (
            not isinstance(access_token, str)
            or not access_token
            or not isinstance(subject, str)
            or not subject
            or subject != principal_subject
            or not isinstance(tenant_id, str)
            or not tenant_id
            or (self.oidc_provider is not None and provider != self.oidc_provider)
        ):
            return None
        return access_token, subject, tenant_id

    @staticmethod
    def _deny(code: str, message: str = "") -> _Decision:
        return _Decision(allow=False, reasons=[_Reason(code=code, message=message)])

    def authorize(self, request: Any) -> _Decision:
        """Perform one uncached, fail-closed IAM permission check."""
        permission_code = self._permission_for(request)
        if permission_code is None:
            return self._deny("iam_permission_unmapped", "No IAM permission mapping exists for this resource action.")

        try:
            resource_id = self._resource_id_for(request)
        except Exception:
            return self._deny("iam_resource_context_invalid", "A valid server-side IAM resource id is required.")

        return self._authorize_with_resource_id(request, permission_code, resource_id)

    def _authorize_with_resource_id(self, request: Any, permission_code: str, resource_id: str | None) -> _Decision:
        """Check a pre-resolved trusted resource id without resolving it twice.

        Candidate filtering uses the same resolved ID for its cache key and
        IAM request; this prevents a stateful resolver from authorizing one
        resource while the cached decision is associated with another.
        """

        principal = getattr(request, "principal", None)
        attributes = getattr(principal, "attributes", None)
        if getattr(principal, "is_internal", False) is True or not isinstance(attributes, Mapping):
            return self._deny("iam_identity_unavailable", "A verified end-user IAM session is required.")

        # DeerFlow's vault resolver puts credentials in an object with a
        # redacted repr, then attaches that object to this short-lived
        # Principal. Keep accepting flat server-owned mappings for existing
        # consumers, but never look in request or model-supplied context.
        credential_context = attributes.get("iam_credentials")
        credential_attributes = credential_context if isinstance(credential_context, Mapping) else attributes
        access_token = credential_attributes.get("iam_access_token")
        subject = credential_attributes.get("iam_subject")
        tenant_id = credential_attributes.get("iam_tenant_id")
        principal_subject = getattr(principal, "oauth_id", None)
        provider = getattr(principal, "oauth_provider", None)
        if (
            not isinstance(access_token, str)
            or not access_token
            or not isinstance(subject, str)
            or not subject
            or subject != principal_subject
            or not isinstance(tenant_id, str)
            or not tenant_id
            or (self.oidc_provider is not None and provider != self.oidc_provider)
        ):
            return self._deny("iam_identity_unavailable", "A verified end-user IAM session is required.")

        try:
            check_arguments: dict[str, Any] = {
                "access_token": access_token,
                "tenant_id": tenant_id,
                "permission_code": permission_code,
                "include_data_scope": False,
            }
            if resource_id is not None:
                check_arguments["resource_id"] = resource_id
            decision = self.client.check(
                **check_arguments,
            )
        except Exception:
            # Do not expose token, URL, network details, or remote error content.
            return self._deny("iam_unavailable", "Central IAM could not complete the authorization check.")

        if decision.application_id != self.application_id:
            return self._deny(
                "iam_application_mismatch",
                "Central IAM did not confirm the configured application context.",
            )
        if not decision.allowed:
            return self._deny("iam_permission_denied", "Central IAM denied this permission.")
        return _Decision(
            allow=True,
            reasons=[_Reason("iam_permission_allowed", "Central IAM allowed this permission.")],
            metadata={"permission_code": permission_code, "application_id": self.application_id},
        )

    async def aauthorize(self, request: Any) -> _Decision:
        """Revalidate a vault-backed session, then check IAM off-loop.

        Request principals usually hold a short-lived credential Mapping with
        no resolver. Agent run principals may hold an ephemeral capability
        exposing ``refresh_if_needed``; it rechecks the local vault session
        and rotates a near-expiry token before the online IAM request.
        """
        principal = getattr(request, "principal", None)
        attributes = getattr(principal, "attributes", None)
        credential_context = attributes.get("iam_credentials") if isinstance(attributes, Mapping) else None
        refresh_if_needed = getattr(credential_context, "refresh_if_needed", None)
        if callable(refresh_if_needed):
            try:
                await refresh_if_needed()
            except Exception:
                # Do not expose vault or OIDC exceptions to Agent events/logs.
                return self._deny("iam_unavailable", "Central IAM could not complete the authorization check.")
        return await asyncio.to_thread(self.authorize, request)

    def filter_resources(self, principal: Any, resource_type: str, candidates: list[str]) -> list[str]:
        """Keep only candidates with an explicit IAM mapping and allow decision.

        Application-level checks may share a decision for the same permission
        code. When resource IDs are resolved, every candidate must be checked
        independently so an allow for one instance cannot expose another.
        """
        action = self.filter_actions.get(resource_type, "use")
        allowed: list[str] = []
        decisions: dict[tuple[str, str | None], bool] = {}
        for target in candidates:
            request = SimpleNamespace(
                principal=principal,
                resource=resource_type,
                action=action,
                target=target,
                context={},
            )
            permission_code = self._permission_for(request)
            if permission_code is None:
                continue
            try:
                # Cache only when both the stable permission and the resolved
                # IAM resource match. A model UUID or tool name gets its own
                # decision, so one grant cannot reveal a sibling resource.
                resource_id = self._resource_id_for(request)
            except Exception:
                continue
            cache_key = (permission_code, resource_id)
            if cache_key not in decisions:
                decisions[cache_key] = self._authorize_with_resource_id(request, permission_code, resource_id).allow
            is_allowed = decisions[cache_key]
            if is_allowed:
                allowed.append(target)
        return allowed
