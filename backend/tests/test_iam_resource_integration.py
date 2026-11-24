"""IAM 密码直登与菜单/按钮资源下发的单元测试（不访问真实 IAM）。"""

import base64
from unittest.mock import AsyncMock

import httpx
import pytest

from app.gateway.auth.oidc import (
    OIDCMetadata,
    OIDCProviderError,
    OIDCService,
)
from app.gateway.routers.auth import _collect_iam_resource_codes

METADATA = OIDCMetadata(
    issuer="https://issuer.example.com",
    authorization_endpoint="https://issuer.example.com/auth",
    token_endpoint="https://issuer.example.com/token",
    userinfo_endpoint=None,
    jwks_uri="https://issuer.example.com/jwks",
)


def _token_response(status_code: int, payload: dict) -> httpx.Response:
    request = httpx.Request("POST", METADATA.token_endpoint)
    return httpx.Response(status_code, request=request, json=payload)


def _basic_credentials(header: str) -> tuple[str, str]:
    """Decode an HTTP Basic header back into its (user-name, password) pair."""
    scheme, encoded = header.split(" ", 1)
    assert scheme == "Basic"
    user_name, password = base64.b64decode(encoded).decode("ascii").split(":", 1)
    return user_name, password


def test_collect_iam_resource_codes_gathers_nested_menus_and_buttons():
    # 按钮挂在菜单的 children 里，必须递归到底；数据规则与结构异常节点都不下发。
    tree = [
        {
            "resource_type": "menu",
            "code": "deerflow.chats",
            "children": [
                {"resource_type": "button", "code": "deerflow.chats.new"},
                {"resource_type": "data_rule", "code": "deerflow.chats.mine"},
                {"resource_type": "button", "code": ""},
            ],
        },
        {"resource_type": "menu", "code": "deerflow.agents", "children": []},
        {"resource_type": "button", "code": "deerflow.runs.cancel"},
        "not-a-node",
        {"resource_type": "menu", "code": None},
    ]

    menus: list[str] = []
    buttons: list[str] = []
    _collect_iam_resource_codes(tree, menus, buttons)

    assert menus == ["deerflow.chats", "deerflow.agents"]
    assert buttons == ["deerflow.chats.new", "deerflow.runs.cancel"]


def test_collect_iam_resource_codes_tolerates_malformed_children():
    # IAM 返回的顶层是数组；子节点类型异常时只跳过该子树，不丢掉已收集的同级节点。
    menus: list[str] = []
    buttons: list[str] = []

    _collect_iam_resource_codes(
        [
            {"resource_type": "menu", "code": "x", "children": "bad"},
            {"resource_type": "menu", "code": "y", "children": [{"resource_type": "button", "code": "y.run"}]},
        ],
        menus,
        buttons,
    )
    _collect_iam_resource_codes(None, menus, buttons)

    assert menus == ["x", "y"]
    assert buttons == ["y.run"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("auth_method", "expects_body_secret"),
    [("client_secret_post", True), ("none", False)],
)
async def test_password_token_keeps_client_id_in_body_unless_basic_auth(monkeypatch, auth_method, expects_body_secret):
    # 非 Basic 方式沿用表单：client_id 始终携带，client_secret_post 再追加密钥。
    service = OIDCService()
    post = AsyncMock(return_value=_token_response(200, {"access_token": "a", "id_token": "i"}))
    monkeypatch.setattr(service._http, "post", post)

    try:
        await service.request_password_token(
            METADATA,
            client_id="deer-flow",
            client_secret="client-secret" if expects_body_secret else None,
            username="user@example.com",
            password="pw",
            scope="openid profile email offline_access",
            auth_method=auth_method,
        )
        data = post.await_args.kwargs["data"]
        assert data["client_id"] == "deer-flow"
        assert data["grant_type"] == "password"
        assert ("client_secret" in data) is expects_body_secret
        assert "Authorization" not in post.await_args.kwargs["headers"]
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_password_token_sends_credentials_only_in_basic_header(monkeypatch):
    # 统一身份平台的 token 端点：表单里再带 client_id 会被判 invalid_request，
    # 所以 Basic 模式下凭据只出现在 Authorization 头。
    service = OIDCService()
    post = AsyncMock(return_value=_token_response(200, {"access_token": "a", "id_token": "i"}))
    monkeypatch.setattr(service._http, "post", post)

    try:
        await service.request_password_token(
            METADATA,
            client_id="deer-flow",
            client_secret="client-secret",
            username="user@example.com",
            password="pw",
            scope="openid profile email offline_access",
            auth_method="client_secret_basic",
        )
        data = post.await_args.kwargs["data"]
        assert "client_id" not in data
        assert "client_secret" not in data
        assert data["grant_type"] == "password"
        assert data["username"] == "user@example.com"
        header = post.await_args.kwargs["headers"]["Authorization"]
        assert _basic_credentials(header) == ("deer-flow", "client-secret")
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_authorization_code_exchange_omits_body_client_id_under_basic_auth(monkeypatch):
    # SSO 授权码兑换与密码授权共用同一套客户端认证，口径必须一致。
    service = OIDCService()
    post = AsyncMock(return_value=_token_response(200, {"access_token": "a", "id_token": "i"}))
    monkeypatch.setattr(service._http, "post", post)

    try:
        await service.exchange_code(
            METADATA,
            client_id="deer-flow",
            client_secret="client-secret",
            code="auth-code",
            redirect_uri="https://app.example.com/api/v1/auth/callback/iam",
            code_verifier="verifier",
            auth_method="client_secret_basic",
        )
        data = post.await_args.kwargs["data"]
        assert "client_id" not in data
        assert "client_secret" not in data
        assert data["code"] == "auth-code"
        assert post.await_args.kwargs["headers"]["Authorization"].startswith("Basic ")
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_token_refresh_omits_body_client_id_under_basic_auth(monkeypatch):
    # 令牌库在 access token 临近到期时轮换，走的是同一个 IAM token 端点，口径必须一致。
    service = OIDCService()
    post = AsyncMock(
        return_value=_token_response(200, {"access_token": "new-access", "expires_in": 600}),
    )
    monkeypatch.setattr(service._http, "post", post)

    try:
        result = await service.refresh_tokens(
            METADATA,
            client_id="deer-flow",
            client_secret="client-secret",
            refresh_token="old-refresh",
            auth_method="client_secret_basic",
        )
        data = post.await_args.kwargs["data"]
        assert data == {"grant_type": "refresh_token", "refresh_token": "old-refresh"}
        assert _basic_credentials(post.await_args.kwargs["headers"]["Authorization"]) == (
            "deer-flow",
            "client-secret",
        )
        assert result.access_token == "new-access"
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_password_token_reports_credential_rejection_without_provider_text(monkeypatch):
    service = OIDCService()
    post = AsyncMock(
        return_value=_token_response(
            400,
            {"error": "invalid_grant", "error_description": "账号或密码不正确 user@example.com"},
        )
    )
    monkeypatch.setattr(service._http, "post", post)

    try:
        with pytest.raises(OIDCProviderError) as exc_info:
            await service.request_password_token(
                METADATA,
                client_id="deer-flow",
                client_secret="client-secret",
                username="user@example.com",
                password="pw",
                scope="openid",
                auth_method="client_secret_basic",
            )
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "invalid_grant"
        # 描述文本可能回显账号或凭据，绝不能进入异常信息。
        assert "user@example.com" not in str(exc_info.value)
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_password_token_preserves_rate_limit_status(monkeypatch):
    service = OIDCService()
    post = AsyncMock(
        return_value=_token_response(429, {"error": "rate_limited", "error_description": "登录尝试过于频繁"})
    )
    monkeypatch.setattr(service._http, "post", post)

    try:
        with pytest.raises(OIDCProviderError) as exc_info:
            await service.request_password_token(
                METADATA,
                client_id="deer-flow",
                client_secret="client-secret",
                username="user@example.com",
                password="pw",
                scope="openid",
                auth_method="client_secret_basic",
            )
        assert exc_info.value.status_code == 429
        assert exc_info.value.error_code == "rate_limited"
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_password_token_ignores_unstructured_provider_error_body(monkeypatch):
    service = OIDCService()
    request = httpx.Request("POST", METADATA.token_endpoint)
    post = AsyncMock(return_value=httpx.Response(401, request=request, text="invalid_client raw text"))
    monkeypatch.setattr(service._http, "post", post)

    try:
        with pytest.raises(OIDCProviderError) as exc_info:
            await service.request_password_token(
                METADATA,
                client_id="deer-flow",
                client_secret="client-secret",
                username="user@example.com",
                password="pw",
                scope="openid",
                auth_method="client_secret_basic",
            )
        assert exc_info.value.status_code == 401
        assert exc_info.value.error_code is None
        assert "raw text" not in str(exc_info.value)
    finally:
        await service.close()
