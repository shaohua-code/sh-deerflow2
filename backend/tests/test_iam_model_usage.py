"""Contract tests for the server-side Central IAM model-usage client."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from deerflow.authz import IamModelQuotaExceeded, IamModelUsageClient, IamModelUsageError, iam_model_usage

_TENANT_ID = str(uuid4())
_MODEL_ID = str(uuid4())
_APPLICATION_ID = str(uuid4())
_USER_ID = str(uuid4())
_GATEWAY_KEY = "g" * 40


def _client() -> IamModelUsageClient:
    return IamModelUsageClient("https://iam.example.test", _GATEWAY_KEY)


def test_resolve_user_id_uses_authenticated_me_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []

    def fake_request(method: str, url: str, **kwargs):  # noqa: ANN001
        calls.append({"method": method, "url": url, **kwargs})
        return SimpleNamespace(status_code=200, json=lambda: {"id": _USER_ID, "status": "active"})

    monkeypatch.setattr(iam_model_usage.httpx, "request", fake_request)

    assert _client().resolve_user_id("verified-bearer") == _USER_ID
    assert calls == [
        {
            "method": "GET",
            "url": "https://iam.example.test/api/v1/auth/me",
            "headers": {"Authorization": "Bearer verified-bearer"},
            "json": None,
            "timeout": 3.0,
        }
    ]


def test_reservation_uses_service_key_and_uuid_subjects(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    def fake_request(method: str, url: str, **kwargs):  # noqa: ANN001
        captured.update(method=method, url=url, **kwargs)
        return SimpleNamespace(status_code=200, json=lambda: {"allowed": True, "reservation_required": True})

    monkeypatch.setattr(iam_model_usage.httpx, "request", fake_request)

    result = _client().reserve_usage(
        request_id="deerflow:call:12345678",
        tenant_id=_TENANT_ID,
        model_id=_MODEL_ID,
        application_id=_APPLICATION_ID,
        user_id=_USER_ID,
        reserved_input_tokens=100,
        reserved_output_tokens=400,
    )

    assert result["allowed"] is True
    assert captured["method"] == "POST"
    assert captured["url"] == "https://iam.example.test/internal/model-usage/reservations"
    assert captured["headers"]["X-IAM-Model-Gateway-Key"] == _GATEWAY_KEY
    assert captured["json"] == {
        "request_id": "deerflow:call:12345678",
        "tenant_id": _TENANT_ID,
        "model_id": _MODEL_ID,
        "application_id": _APPLICATION_ID,
        "user_id": _USER_ID,
        "reserved_input_tokens": 100,
        "reserved_output_tokens": 400,
    }


def test_settlement_and_unreserved_report_use_distinct_endpoints(monkeypatch: pytest.MonkeyPatch) -> None:
    urls: list[str] = []

    def fake_request(method: str, url: str, **kwargs):  # noqa: ANN001
        urls.append(url)
        result = {"settled": True} if url.endswith("/settle") else {"recorded": True}
        return SimpleNamespace(status_code=200, json=lambda: result)

    monkeypatch.setattr(iam_model_usage.httpx, "request", fake_request)
    client = _client()

    assert (
        client.settle_usage(
            request_id="deerflow:call:12345678",
            input_tokens=95,
            output_tokens=20,
            outcome="succeeded",
            usage_is_estimated=False,
            latency_ms=1200,
        )["settled"]
        is True
    )
    assert (
        client.report_usage(
            request_id="deerflow:call:abcdefgh",
            tenant_id=_TENANT_ID,
            model_id=_MODEL_ID,
            application_id=_APPLICATION_ID,
            user_id=_USER_ID,
            input_tokens=95,
            output_tokens=20,
            outcome="succeeded",
            usage_is_estimated=False,
            latency_ms=1200,
        )["recorded"]
        is True
    )
    assert urls == [
        "https://iam.example.test/internal/model-usage/reservations/settle",
        "https://iam.example.test/internal/model-usage",
    ]


def test_quota_and_transport_errors_are_redacted(monkeypatch: pytest.MonkeyPatch) -> None:
    def quota_request(method: str, url: str, **kwargs):  # noqa: ANN001
        return SimpleNamespace(status_code=429, json=lambda: {"detail": "sensitive provider payload"})

    monkeypatch.setattr(iam_model_usage.httpx, "request", quota_request)
    with pytest.raises(IamModelQuotaExceeded, match="IAM model quota exceeded") as quota_error:
        _client().reserve_usage(
            request_id="deerflow:call:12345678",
            tenant_id=_TENANT_ID,
            model_id=_MODEL_ID,
            application_id=_APPLICATION_ID,
            user_id=_USER_ID,
            reserved_input_tokens=10,
            reserved_output_tokens=10,
        )
    assert "sensitive" not in str(quota_error.value)

    def service_error(method: str, url: str, **kwargs):  # noqa: ANN001
        request = iam_model_usage.httpx.Request(method, url)
        return iam_model_usage.httpx.Response(503, request=request, text="secret response body")

    monkeypatch.setattr(iam_model_usage.httpx, "request", service_error)
    with pytest.raises(IamModelUsageError, match="IAM rejected the model-usage request") as api_error:
        _client().resolve_user_id("verified-bearer")
    assert "secret response" not in str(api_error.value)


def test_rejects_opaque_subject_and_invalid_reservation_payload_before_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        iam_model_usage.httpx,
        "request",
        lambda *args, **kwargs: SimpleNamespace(status_code=200, json=lambda: {"id": "opaque-subject"}),
    )
    with pytest.raises(IamModelUsageError, match="IAM returned an invalid authenticated user"):
        _client().resolve_user_id("verified-bearer")

    def unexpected_network(*args, **kwargs):  # noqa: ANN001
        pytest.fail("invalid payload must be rejected before HTTP")

    monkeypatch.setattr(iam_model_usage.httpx, "request", unexpected_network)
    with pytest.raises(ValueError, match="tenant ID must be a UUID"):
        _client().reserve_usage(
            request_id="deerflow:call:12345678",
            tenant_id="opaque-tenant",
            model_id=_MODEL_ID,
            application_id=_APPLICATION_ID,
            user_id=_USER_ID,
            reserved_input_tokens=10,
            reserved_output_tokens=10,
        )
