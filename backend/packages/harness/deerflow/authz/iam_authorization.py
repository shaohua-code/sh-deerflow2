"""Dependency-free server-side helper for the IAM authorization decision endpoint.

Use a locally verified OIDC access token and tenant/user ids taken from the verified session.
This client intentionally does not retain credentials or implement OIDC token validation.
"""
import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class AuthorizationServiceError(RuntimeError):
    """IAM denied the request, returned an invalid response, or could not be reached."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class AuthorizationDecision:
    allowed: bool
    reason: str
    data_scope: dict[str, Any] | None = None
    application_id: str | None = None


@dataclass(frozen=True)
class PostgresScopeFilter:
    """可交给 SQLAlchemy text() / psycopg 的参数化 PostgreSQL 谓词。"""

    sql: str
    parameters: dict[str, Any]


class IamAuthorizationClient:
    """Call IAM from a protected backend route using its user's access token."""

    def __init__(self, api_base_url: str, application_id: str | None = None, timeout_seconds: float = 3.0) -> None:
        self.endpoint = api_base_url.rstrip("/") + "/api/v1/authorization/check"
        self.application_id = application_id
        self.timeout_seconds = timeout_seconds

    def check(
        self,
        access_token: str,
        tenant_id: str,
        permission_code: str,
        resource_id: str | None = None,
        include_data_scope: bool = False,
        subject_id: str | None = None,
    ) -> AuthorizationDecision:
        """Return a decision; any transport or contract error is raised, never allowed."""
        if not access_token:
            raise ValueError("An end-user OIDC access token is required")
        if include_data_scope and (not isinstance(subject_id, str) or not subject_id.strip()):
            # owner_user_id 是行级过滤条件的一部分；必须绑定到本地验签会话中的 sub。
            # subject_id 必须是已验签 IAM OIDC sub，不能误传业务系统自己的本地用户主键。
            # 它只用于校验 IAM 响应，不发送给 IAM，也不允许来自浏览器请求参数。
            raise ValueError("A locally verified IAM subject_id is required when requesting a data scope")
        # OIDC sub 是不透明且区分大小写的值；只做非空校验，比较时保留原值。
        verified_subject_id = subject_id if include_data_scope else None
        payload: dict[str, Any] = {
            "tenant_id": tenant_id,
            "permission_code": permission_code,
            "include_data_scope": include_data_scope,
        }
        if self.application_id:
            payload["application_id"] = self.application_id
        if resource_id:
            payload["resource_id"] = resource_id
        request = Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                body = json.loads(response.read())
        except HTTPError as exc:
            raise AuthorizationServiceError(exc.code, "IAM rejected the authorization request") from None
        except (URLError, TimeoutError, OSError):
            raise AuthorizationServiceError(503, "IAM authorization service is unavailable") from None
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise AuthorizationServiceError(502, "IAM returned an invalid authorization response") from None
        if not isinstance(body, dict) or not isinstance(body.get("allowed"), bool) or not isinstance(body.get("reason"), str):
            raise AuthorizationServiceError(502, "IAM returned an invalid authorization decision")
        if "data_scope" in body and body["data_scope"] is not None:
            if not body["allowed"] or not include_data_scope:
                raise AuthorizationServiceError(502, "IAM returned an unexpected data scope")
            data_scope = _validate_data_scope(body["data_scope"], tenant_id, verified_subject_id or "")
        elif body["allowed"] and include_data_scope:
            # A positive data-aware permission is unusable unless its row filter is present.
            raise AuthorizationServiceError(502, "IAM omitted the required data scope")
        else:
            data_scope = None
        application_id = body.get("application_id")
        if application_id is not None and (not isinstance(application_id, str) or not application_id.strip()):
            raise AuthorizationServiceError(502, "IAM returned an invalid application context")
        return AuthorizationDecision(body["allowed"], body["reason"], data_scope, application_id)

    def require(self, *args: Any, **kwargs: Any) -> AuthorizationDecision:
        """Raise 403-style error for a negative IAM decision; callers should fail closed."""
        decision = self.check(*args, **kwargs)
        if not decision.allowed:
            raise AuthorizationServiceError(403, f"Permission denied: {decision.reason}")
        return decision


def _validate_data_scope(value: Any, expected_tenant_id: str, expected_subject_id: str) -> dict[str, Any]:
    """Validate the complete row-filter contract before handing it to a business query.

    Every OR branch must independently carry the verified tenant. Restricting the
    discriminator and business field names here prevents malformed IAM responses from
    accidentally becoming an unscoped query in an adapter.
    """
    if (not isinstance(expected_tenant_id, str) or not expected_tenant_id
            or not isinstance(expected_subject_id, str) or not expected_subject_id
            or not isinstance(value, dict) or value.get("mode") != "any_of"):
        raise AuthorizationServiceError(502, "IAM returned an invalid data scope")
    constraints = value.get("constraints")
    if not isinstance(constraints, list) or not constraints:
        raise AuthorizationServiceError(502, "IAM returned an empty data scope")
    normalized: list[dict[str, Any]] = []
    for constraint in constraints:
        kind = constraint.get("kind") if isinstance(constraint, dict) else None
        branch_tenant_id = constraint.get("tenant_id") if isinstance(constraint, dict) else None
        if (not isinstance(constraint, dict) or not isinstance(kind, str)
                or not isinstance(branch_tenant_id, str)
                or branch_tenant_id.lower() != expected_tenant_id.lower()
                or kind not in {"tenant", "owner", "organizations"}):
            raise AuthorizationServiceError(502, "IAM returned a cross-tenant or unknown data constraint")
        if kind == "tenant":
            normalized.append({"kind": "tenant", "tenant_id": expected_tenant_id})
        elif kind == "owner":
            user_id = constraint.get("user_id")
            if (constraint.get("field") != "owner_user_id" or not isinstance(user_id, str) or not user_id
                    or user_id != expected_subject_id):
                raise AuthorizationServiceError(502, "IAM returned an invalid owner constraint")
            normalized.append({"kind": "owner", "field": "owner_user_id", "user_id": user_id,
                               "tenant_id": expected_tenant_id})
        else:
            organization_ids = constraint.get("organization_ids")
            if (constraint.get("field") != "organization_id" or not isinstance(organization_ids, list)
                    or any(not isinstance(item, str) or not item for item in organization_ids)):
                raise AuthorizationServiceError(502, "IAM returned an invalid organization constraint")
            normalized.append({"kind": "organizations", "field": "organization_id",
                               "organization_ids": list(organization_ids), "tenant_id": expected_tenant_id})
    return {"mode": "any_of", "constraints": normalized}


def compile_postgres_data_scope(
    data_scope: Mapping[str, Any],
    *,
    tenant_id: str,
    subject_id: str,
    columns: Mapping[str, str],
    map_tenant_id: Callable[[str], str | int] | None = None,
    map_owner_user_id: Callable[[str, str], str | int] | None = None,
    map_organization_ids: Callable[[Sequence[str], str], Sequence[str | int]] | None = None,
) -> PostgresScopeFilter:
    """将已验证的 IAM any_of 条件编译成安全的 PostgreSQL WHERE 谓词。

    IAM 字段永远不会成为 SQL 标识符；列名仅来自业务代码传入的白名单映射，
    每个 OR 分支都单独 AND 租户条件。本地用户主键不同时必须提供显式映射函数。
    """
    def fail(message: str) -> None:
        raise AuthorizationServiceError(502, message)

    if (not isinstance(tenant_id, str) or not tenant_id.strip()
            or not isinstance(subject_id, str) or not subject_id.strip()
            or not isinstance(data_scope, Mapping) or data_scope.get("mode") != "any_of"):
        fail("Cannot compile an empty or unverified IAM data scope")
    constraints = data_scope.get("constraints")
    if not isinstance(constraints, list) or not constraints:
        fail("Cannot compile an empty or unverified IAM data scope")

    # 业务列只能使用开发者维护的简单列名或 table.column 标识符，并统一加引号。
    def quote_column(name: Any) -> str:
        if not isinstance(name, str) or not name or not all(
            re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", part) for part in name.split(".")
        ):
            fail("IAM data-scope column mapping is missing or invalid")
        return ".".join(f'"{part}"' for part in name.split("."))

    def scalar(value: Any) -> str | int:
        if isinstance(value, str) and value.strip() and "\x00" not in value:
            return value
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        fail("IAM data-scope identity mapping returned an invalid key")

    def mapped_scalar(mapper: Callable[..., Any] | None, *args: Any) -> str | int:
        try:
            value = mapper(*args) if mapper else args[0]
        except Exception:
            # 本地映射服务故障同样必须停止查询，且不能透出数据库异常原文。
            raise AuthorizationServiceError(503, "Business identity mapping service is unavailable") from None
        return scalar(value)

    tenant_value = mapped_scalar(map_tenant_id, tenant_id)
    tenant_column = quote_column(columns.get("tenant_id"))
    params: dict[str, Any] = {}
    branches: list[str] = []

    def bind(value: Any) -> str:
        name = f"iam_scope_{len(params) + 1}"
        params[name] = value
        return f":{name}"

    for constraint in constraints:
        if not isinstance(constraint, Mapping):
            fail("IAM data-scope branch is invalid")
        branch_tenant_id = constraint.get("tenant_id")
        if (not isinstance(branch_tenant_id, str)
                or branch_tenant_id.lower() != tenant_id.lower()):
            fail("IAM data-scope branch does not match the verified tenant")
        tenant_predicate = f"{tenant_column} = {bind(tenant_value)}"
        kind = constraint.get("kind")
        if kind == "tenant":
            branches.append(f"({tenant_predicate})")
            continue
        if kind == "owner":
            owner_subject = constraint.get("user_id")
            if constraint.get("field") != "owner_user_id" or owner_subject != subject_id:
                fail("IAM owner scope does not match the verified subject")
            owner_value = mapped_scalar(map_owner_user_id, owner_subject, tenant_id)
            branches.append(
                f"({tenant_predicate} AND {quote_column(columns.get('owner_user_id'))} = {bind(owner_value)})"
            )
            continue
        if kind == "organizations":
            raw_ids = constraint.get("organization_ids")
            if (constraint.get("field") != "organization_id" or not isinstance(raw_ids, list)
                    or any(not isinstance(item, str) or not item.strip() for item in raw_ids)):
                fail("IAM organization scope is invalid")
            try:
                mapped_ids = map_organization_ids(raw_ids, tenant_id) if map_organization_ids else raw_ids
            except Exception:
                # 组织映射不完整时不能退回到未过滤的租户查询。
                raise AuthorizationServiceError(503, "Business identity mapping service is unavailable") from None
            if not isinstance(mapped_ids, (list, tuple)):
                fail("IAM organization mapping returned an invalid list")
            organization_ids = list(dict.fromkeys(scalar(item) for item in mapped_ids))
            if not organization_ids:
                # 空组织范围必须明确匹配零行，不能退化成仅按租户查询。
                branches.append(f"({tenant_predicate} AND FALSE)")
                continue
            branches.append(
                f"({tenant_predicate} AND {quote_column(columns.get('organization_id'))} = ANY({bind(organization_ids)}))"
            )
            continue
        fail("IAM data scope contains an unsupported constraint")

    if not branches:
        fail("IAM data scope produced no query branches")
    return PostgresScopeFilter(f"({' OR '.join(branches)})", params)
