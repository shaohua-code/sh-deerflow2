"""Server-side client for Central IAM model-usage APIs.

This module deliberately handles identifiers and token counts only. It never
accepts, stores, or logs prompts, model responses, or Provider credentials.
The caller must first complete ``model.invoke`` authorization and resolve the
canonical IAM user UUID with the same verified OIDC access token.
"""

from __future__ import annotations

import re
from typing import Any, Literal
from uuid import UUID

import httpx

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,180}$")
_MAX_TOKENS = 10_000_000
_MAX_LATENCY_MS = 86_400_000


class IamModelUsageError(RuntimeError):
    """Safe, response-body-free error from the IAM model-usage service."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


class IamModelQuotaExceeded(IamModelUsageError):
    """IAM rejected a model call before Provider dispatch because of quota."""


class IamModelUsageClient:
    """Call the IAM usage API using a server-only gateway key.

    The OIDC access token is used only by :meth:`resolve_user_id` against
    ``/auth/me``. All usage endpoints use the independent service key. Keep
    both credentials in server memory and never include them in callback
    metadata, checkpoints, reprs, or logs.
    """

    def __init__(self, api_base_url: str, gateway_key: str, *, timeout_seconds: float = 3.0) -> None:
        if not isinstance(api_base_url, str) or not api_base_url.strip():
            raise ValueError("api_base_url is required")
        if not isinstance(gateway_key, str) or len(gateway_key) < 32:
            raise ValueError("IAM model usage gateway key must contain at least 32 characters")
        if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, int | float) or not 0 < timeout_seconds <= 30:
            raise ValueError("timeout_seconds must be between 0 and 30")

        self._api_base_url = api_base_url.strip().rstrip("/")
        self._gateway_key = gateway_key
        self._timeout_seconds = float(timeout_seconds)

    def resolve_user_id(self, access_token: str) -> str:
        """Resolve IAM's canonical UUID from the verified session's OIDC token.

        OIDC ``sub`` is opaque and must not be treated as an IAM user UUID.
        The IAM API authenticates this bearer token and returns the user record
        that the usage ledger expects.
        """
        if not isinstance(access_token, str) or not access_token:
            raise ValueError("A verified IAM access token is required")
        response = self._request(
            "GET",
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        raw_id = response.get("id")
        if not isinstance(raw_id, str):
            raise IamModelUsageError(502, "IAM returned an invalid authenticated user")
        try:
            return self._uuid(raw_id, "IAM user ID")
        except ValueError:
            raise IamModelUsageError(502, "IAM returned an invalid authenticated user") from None

    def reserve_usage(
        self,
        *,
        request_id: str,
        tenant_id: str,
        model_id: str,
        application_id: str,
        user_id: str,
        reserved_input_tokens: int,
        reserved_output_tokens: int,
    ) -> dict[str, Any]:
        """Reserve estimated usage before a Provider call is dispatched."""
        payload = {
            "request_id": self._request_id(request_id),
            "tenant_id": self._uuid(tenant_id, "tenant ID"),
            "model_id": self._uuid(model_id, "model ID"),
            "application_id": self._uuid(application_id, "application ID"),
            "user_id": self._uuid(user_id, "user ID"),
            "reserved_input_tokens": self._token_count(reserved_input_tokens, allow_zero=True),
            "reserved_output_tokens": self._token_count(reserved_output_tokens, allow_zero=False),
        }
        result = self._request("POST", "/internal/model-usage/reservations", payload=payload, service_auth=True)
        if not isinstance(result.get("allowed"), bool) or not isinstance(result.get("reservation_required"), bool):
            raise IamModelUsageError(502, "IAM returned an invalid model-usage reservation")
        if not result["allowed"]:
            raise IamModelQuotaExceeded(429, "IAM denied model usage admission")
        return result

    def settle_usage(
        self,
        *,
        request_id: str,
        input_tokens: int,
        output_tokens: int,
        outcome: Literal["succeeded", "failed"],
        usage_is_estimated: bool,
        latency_ms: int,
    ) -> dict[str, Any]:
        """Settle one prior reservation with actual or explicitly estimated usage."""
        payload = self._settlement_payload(
            request_id,
            input_tokens,
            output_tokens,
            outcome,
            usage_is_estimated,
            latency_ms,
        )
        result = self._request("POST", "/internal/model-usage/reservations/settle", payload=payload, service_auth=True)
        if not isinstance(result.get("settled"), bool):
            raise IamModelUsageError(502, "IAM returned an invalid model-usage settlement")
        return result

    def report_usage(
        self,
        *,
        request_id: str,
        tenant_id: str,
        model_id: str,
        application_id: str,
        user_id: str,
        input_tokens: int,
        output_tokens: int,
        outcome: Literal["succeeded", "failed"],
        usage_is_estimated: bool,
        latency_ms: int,
    ) -> dict[str, Any]:
        """Report usage when IAM says that no enforced reservation is required."""
        payload = {
            "tenant_id": self._uuid(tenant_id, "tenant ID"),
            "model_id": self._uuid(model_id, "model ID"),
            "application_id": self._uuid(application_id, "application ID"),
            "user_id": self._uuid(user_id, "user ID"),
            **self._settlement_payload(
                request_id,
                input_tokens,
                output_tokens,
                outcome,
                usage_is_estimated,
                latency_ms,
            ),
        }
        result = self._request("POST", "/internal/model-usage", payload=payload, service_auth=True)
        if not isinstance(result.get("recorded"), bool):
            raise IamModelUsageError(502, "IAM returned an invalid model-usage report")
        return result

    def _request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        service_auth: bool = False,
    ) -> dict[str, Any]:
        request_headers = dict(headers or {})
        if payload is not None:
            request_headers["Content-Type"] = "application/json"
        if service_auth:
            request_headers["X-IAM-Model-Gateway-Key"] = self._gateway_key
        try:
            response = httpx.request(
                method,
                self._api_base_url + path,
                headers=request_headers,
                json=payload,
                timeout=self._timeout_seconds,
            )
        except httpx.TimeoutException:
            raise IamModelUsageError(503, "IAM model-usage service timed out") from None
        except httpx.RequestError:
            raise IamModelUsageError(503, "IAM model-usage service is unavailable") from None

        if response.status_code == 429:
            raise IamModelQuotaExceeded(429, "IAM model quota exceeded")
        if not 200 <= response.status_code < 300:
            raise IamModelUsageError(response.status_code, "IAM rejected the model-usage request")
        try:
            body = response.json()
        except (ValueError, UnicodeDecodeError):
            raise IamModelUsageError(502, "IAM returned invalid model-usage JSON") from None
        if not isinstance(body, dict):
            raise IamModelUsageError(502, "IAM returned an invalid model-usage response")
        return body

    @staticmethod
    def _uuid(value: str, label: str) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{label} must be a UUID")
        try:
            return str(UUID(value))
        except (ValueError, AttributeError) as exc:
            raise ValueError(f"{label} must be a UUID") from exc

    @staticmethod
    def _request_id(value: str) -> str:
        if not isinstance(value, str) or not _REQUEST_ID_RE.fullmatch(value):
            raise ValueError("request ID must contain 8 to 180 safe characters")
        return value

    @staticmethod
    def _token_count(value: int, *, allow_zero: bool) -> int:
        minimum = 0 if allow_zero else 1
        if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= _MAX_TOKENS:
            raise ValueError("token count is outside the supported range")
        return value

    @classmethod
    def _settlement_payload(
        cls,
        request_id: str,
        input_tokens: int,
        output_tokens: int,
        outcome: Literal["succeeded", "failed"],
        usage_is_estimated: bool,
        latency_ms: int,
    ) -> dict[str, Any]:
        if outcome not in ("succeeded", "failed"):
            raise ValueError("outcome must be succeeded or failed")
        if not isinstance(usage_is_estimated, bool):
            raise ValueError("usage_is_estimated must be a boolean")
        if isinstance(latency_ms, bool) or not isinstance(latency_ms, int) or not 0 <= latency_ms <= _MAX_LATENCY_MS:
            raise ValueError("latency is outside the supported range")
        return {
            "request_id": cls._request_id(request_id),
            "input_tokens": cls._token_count(input_tokens, allow_zero=True),
            "output_tokens": cls._token_count(output_tokens, allow_zero=True),
            "outcome": outcome,
            "usage_is_estimated": usage_is_estimated,
            "latency_ms": latency_ms,
        }
