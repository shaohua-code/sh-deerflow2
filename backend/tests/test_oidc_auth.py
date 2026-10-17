from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

from app.gateway.auth.models import User
from app.gateway.auth.oidc import (
    OIDCError,
    OIDCIdentity,
    OIDCMetadata,
    OIDCService,
    OIDCTokenRefreshResult,
    OIDCUserInfoMismatch,
    OIDCValidationError,
)
from app.gateway.auth.user_provisioning import get_or_provision_oidc_user
from deerflow.config.auth_config import OIDCProviderConfig


def _provider_config(**overrides):
    return OIDCProviderConfig(
        display_name="Test SSO",
        issuer="https://issuer.example.com",
        client_id="deer-flow",
        **overrides,
    )


def _identity(**overrides):
    values = {
        "provider": "keycloak",
        "subject": "oidc-subject",
        "email": "user@example.com",
        "email_verified": True,
        "name": "Test User",
        "claims": {},
    }
    values.update(overrides)
    return OIDCIdentity(**values)


@pytest.mark.asyncio
async def test_oidc_existing_local_account_blocks_sso_login_even_when_unverified():
    local_user = User(email="user@example.com", password_hash="hash")
    local_provider = AsyncMock()
    local_provider.get_user_by_oauth.return_value = None
    local_provider.get_user_by_email.return_value = local_user

    with pytest.raises(HTTPException) as exc_info:
        await get_or_provision_oidc_user(
            provider_id="keycloak",
            provider_config=_provider_config(
                require_verified_email=False,
                auto_create_users=False,
            ),
            identity=_identity(email_verified=False),
            local_provider=local_provider,
        )

    assert exc_info.value.status_code == 409
    local_provider.update_user.assert_not_called()


@pytest.mark.asyncio
async def test_oidc_existing_local_account_blocks_sso_login_even_when_verified():
    local_user = User(email="user@example.com", password_hash="hash")
    local_provider = AsyncMock()
    local_provider.get_user_by_oauth.return_value = None
    local_provider.get_user_by_email.return_value = local_user

    with pytest.raises(HTTPException) as exc_info:
        await get_or_provision_oidc_user(
            provider_id="keycloak",
            provider_config=_provider_config(auto_create_users=False),
            identity=_identity(subject="verified-subject"),
            local_provider=local_provider,
        )

    assert exc_info.value.status_code == 409
    local_provider.update_user.assert_not_called()
    local_provider.create_oauth_user.assert_not_called()


@pytest.mark.asyncio
async def test_oidc_auto_create_never_assigns_admin_from_configured_email():
    local_provider = AsyncMock()
    local_provider.get_user_by_oauth.return_value = None
    local_provider.get_user_by_email.return_value = None
    created_user = User(
        email="admin@example.com",
        password_hash=None,
        system_role="user",
        oauth_provider="keycloak",
        oauth_id="admin-subject",
    )
    local_provider.create_oauth_user.return_value = created_user

    result = await get_or_provision_oidc_user(
        provider_id="keycloak",
        provider_config=_provider_config(admin_emails=["ADMIN@example.com"]),
        identity=_identity(subject="admin-subject", email="admin@example.com"),
        local_provider=local_provider,
    )

    assert result == {"user": created_user, "created": True}
    local_provider.create_oauth_user.assert_awaited_once_with(
        email="admin@example.com",
        oauth_provider="keycloak",
        oauth_id="admin-subject",
        system_role="user",
    )


@pytest.mark.asyncio
async def test_oidc_validate_id_token_refreshes_jwks_once_on_kid_miss(monkeypatch):
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint=None,
        jwks_uri="https://issuer.example.com/jwks",
    )
    load_calls = []
    resolve_results = [None, "signing-key"]

    async def load_jwks(jwks_uri, force_refresh=False):
        load_calls.append(force_refresh)
        return {"keys": []}

    async def resolve_signing_key(jwks_data, kid, algorithm, jwks_uri):
        return resolve_results.pop(0)

    monkeypatch.setattr(service, "_load_jwks", load_jwks)
    monkeypatch.setattr(service, "_resolve_signing_key", resolve_signing_key)
    monkeypatch.setattr("app.gateway.auth.oidc.jwt.get_unverified_header", lambda token: {"kid": "new-kid", "alg": "RS256"})
    monkeypatch.setattr(
        "app.gateway.auth.oidc.jwt.decode",
        lambda *args, **kwargs: {"iss": metadata.issuer, "sub": "subject", "aud": "deer-flow", "exp": 9999999999},
    )

    claims = await service.validate_id_token(metadata, "deer-flow", "id-token")

    assert claims["sub"] == "subject"
    assert load_calls == [False, True]
    await service.close()


@pytest.mark.asyncio
async def test_oidc_validate_id_token_rejects_hmac_algorithms(monkeypatch):
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint=None,
        jwks_uri="https://issuer.example.com/jwks",
    )

    async def load_jwks(jwks_uri, force_refresh=False):
        return {"keys": [{"kid": "kid", "kty": "oct", "k": "secret"}]}

    async def resolve_signing_key(jwks_data, kid, algorithm, jwks_uri):
        return "secret"

    def decode(*args, **kwargs):
        assert "HS256" not in kwargs["algorithms"]
        raise OIDCValidationError("HMAC algorithms must not be accepted")

    monkeypatch.setattr(service, "_load_jwks", load_jwks)
    monkeypatch.setattr(service, "_resolve_signing_key", resolve_signing_key)
    monkeypatch.setattr("app.gateway.auth.oidc.jwt.get_unverified_header", lambda token: {"kid": "kid", "alg": "HS256"})
    monkeypatch.setattr("app.gateway.auth.oidc.jwt.decode", decode)

    with pytest.raises(OIDCValidationError, match="unsupported algorithm"):
        await service.validate_id_token(metadata, "deer-flow", "id-token")

    await service.close()


@pytest.mark.asyncio
async def test_oidc_existing_account_lookup_uses_normalized_email():
    local_user = User(email="user@example.com", password_hash="hash")
    local_provider = AsyncMock()
    local_provider.get_user_by_oauth.return_value = None
    local_provider.get_user_by_email.return_value = local_user

    with pytest.raises(HTTPException) as exc_info:
        await get_or_provision_oidc_user(
            provider_id="keycloak",
            provider_config=_provider_config(auto_create_users=False),
            identity=_identity(email="User@Example.COM"),
            local_provider=local_provider,
        )

    assert exc_info.value.status_code == 409
    local_provider.get_user_by_email.assert_awaited_once_with("user@example.com")


@pytest.mark.asyncio
async def test_oidc_auto_create_uses_normalized_email():
    local_provider = AsyncMock()
    local_provider.get_user_by_oauth.return_value = None
    local_provider.get_user_by_email.return_value = None
    created_user = User(email="user@example.com", password_hash=None, oauth_provider="keycloak", oauth_id="subject")
    local_provider.create_oauth_user.return_value = created_user

    await get_or_provision_oidc_user(
        provider_id="keycloak",
        provider_config=_provider_config(),
        identity=_identity(subject="subject", email="User@Example.COM"),
        local_provider=local_provider,
    )

    local_provider.create_oauth_user.assert_awaited_once_with(
        email="user@example.com",
        oauth_provider="keycloak",
        oauth_id="subject",
        system_role="user",
    )


@pytest.mark.asyncio
async def test_oidc_metadata_from_dict_accepts_missing_overrides():
    service = OIDCService()

    metadata = service._metadata_from_dict(
        {
            "issuer": "https://issuer.example.com",
            "authorization_endpoint": "https://issuer.example.com/auth",
            "token_endpoint": "https://issuer.example.com/token",
            "userinfo_endpoint": "https://issuer.example.com/userinfo",
            "jwks_uri": "https://issuer.example.com/jwks",
        },
        None,
    )

    assert metadata.jwks_uri == "https://issuer.example.com/jwks"
    assert metadata.revocation_endpoint is None
    await service.close()


@pytest.mark.asyncio
async def test_oidc_metadata_reads_revocation_endpoint_and_explicit_override():
    service = OIDCService()
    discovery = {
        "issuer": "https://issuer.example.com",
        "authorization_endpoint": "https://issuer.example.com/auth",
        "token_endpoint": "https://issuer.example.com/token",
        "userinfo_endpoint": None,
        "jwks_uri": "https://issuer.example.com/jwks",
        "revocation_endpoint": "https://issuer.example.com/revoke",
    }

    try:
        discovered = service._metadata_from_dict(discovery, None)
        overridden = service._metadata_from_dict(
            discovery,
            {"revocation_endpoint": "https://iam.example.com/oauth/revoke"},
        )
        assert discovered.revocation_endpoint == "https://issuer.example.com/revoke"
        assert overridden.revocation_endpoint == "https://iam.example.com/oauth/revoke"
    finally:
        await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "userinfo",
    [
        {"email": "unbound@example.com", "email_verified": True},
        {"sub": None, "email": "unbound@example.com", "email_verified": True},
        {"sub": "different-subject", "email": "unbound@example.com", "email_verified": True},
    ],
)
async def test_oidc_fetch_userinfo_rejects_missing_or_mismatched_subject(monkeypatch, userinfo):
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint="https://issuer.example.com/userinfo",
        jwks_uri="https://issuer.example.com/jwks",
    )
    response = SimpleNamespace(raise_for_status=lambda: None, json=lambda: userinfo)
    monkeypatch.setattr(service._http, "get", AsyncMock(return_value=response))

    try:
        with pytest.raises(OIDCUserInfoMismatch):
            await service.fetch_userinfo(metadata, "access-token", "expected-subject")
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_oidc_fetch_userinfo_accepts_exact_id_token_subject(monkeypatch):
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint="https://issuer.example.com/userinfo",
        jwks_uri="https://issuer.example.com/jwks",
    )
    userinfo = {"sub": "expected-subject", "email": "user@example.com"}
    response = SimpleNamespace(raise_for_status=lambda: None, json=lambda: userinfo)
    monkeypatch.setattr(service._http, "get", AsyncMock(return_value=response))

    try:
        result = await service.fetch_userinfo(metadata, "access-token", "expected-subject")
        assert result == userinfo
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_oidc_refresh_tokens_uses_configured_client_auth_and_redacts_credentials(monkeypatch):
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint=None,
        jwks_uri="https://issuer.example.com/jwks",
    )
    response = SimpleNamespace(
        raise_for_status=lambda: None,
        json=lambda: {
            "access_token": "new-access-token",
            "refresh_token": "new-refresh-token",
            "expires_in": 600,
            "refresh_expires_in": 3600,
        },
    )
    post = AsyncMock(return_value=response)
    monkeypatch.setattr(service._http, "post", post)

    try:
        result = await service.refresh_tokens(
            metadata,
            client_id="deer-flow",
            client_secret="client-secret",
            refresh_token="old-refresh-token",
            auth_method="client_secret_post",
        )
        assert isinstance(result, OIDCTokenRefreshResult)
        assert result.access_token == "new-access-token"
        assert result.refresh_token == "new-refresh-token"
        assert result.expires_in == 600
        assert result.refresh_expires_in == 3600
        assert "new-access-token" not in repr(result)
        assert "new-refresh-token" not in repr(result)
        assert post.await_args.kwargs["data"] == {
            "grant_type": "refresh_token",
            "refresh_token": "old-refresh-token",
            "client_id": "deer-flow",
            "client_secret": "client-secret",
        }
        assert post.await_args.kwargs["headers"] == {"Accept": "application/json"}
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_oidc_refresh_tokens_omits_client_secret_for_basic_auth(monkeypatch):
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint=None,
        jwks_uri="https://issuer.example.com/jwks",
    )
    response = SimpleNamespace(
        raise_for_status=lambda: None,
        json=lambda: {"access_token": "new-access-token", "expires_in": 600},
    )
    post = AsyncMock(return_value=response)
    monkeypatch.setattr(service._http, "post", post)

    try:
        result = await service.refresh_tokens(
            metadata,
            client_id="deer-flow",
            client_secret="client-secret",
            refresh_token="old-refresh-token",
            auth_method="client_secret_basic",
        )
        assert result.refresh_token is None
        assert "client_secret" not in post.await_args.kwargs["data"]
        assert post.await_args.kwargs["headers"]["Authorization"].startswith("Basic ")
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_oidc_refresh_tokens_do_not_expose_provider_error_body(monkeypatch):
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint=None,
        jwks_uri="https://issuer.example.com/jwks",
    )
    request = httpx.Request("POST", metadata.token_endpoint)
    response = httpx.Response(401, request=request, text="refresh-token-echoed-by-provider")
    post = AsyncMock(side_effect=httpx.HTTPStatusError("provider denied", request=request, response=response))
    monkeypatch.setattr(service._http, "post", post)

    try:
        with pytest.raises(OIDCError) as exc_info:
            await service.refresh_tokens(
                metadata,
                client_id="deer-flow",
                client_secret=None,
                refresh_token="refresh-token",
            )
        assert str(exc_info.value) == "OIDC token refresh failed: HTTP 401"
        assert "refresh-token" not in str(exc_info.value)
        assert "refresh-token-echoed-by-provider" not in str(exc_info.value)
    finally:
        await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("auth_method", "expected_secret"),
    [
        ("client_secret_post", True),
        ("client_secret_basic", False),
        ("none", False),
    ],
)
async def test_oidc_revoke_token_uses_rfc7009_form_and_configured_client_auth(monkeypatch, auth_method, expected_secret):
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint=None,
        jwks_uri="https://issuer.example.com/jwks",
        revocation_endpoint="https://issuer.example.com/revoke",
    )
    response = SimpleNamespace(raise_for_status=lambda: None)
    post = AsyncMock(return_value=response)
    monkeypatch.setattr(service._http, "post", post)

    try:
        await service.revoke_token(
            metadata,
            client_id="deer-flow",
            client_secret="client-secret",
            token="opaque-refresh-token",
            token_type_hint="refresh_token",
            auth_method=auth_method,
        )
        kwargs = post.await_args.kwargs
        assert post.await_args.args == (metadata.revocation_endpoint,)
        assert kwargs["data"]["token"] == "opaque-refresh-token"
        assert kwargs["data"]["token_type_hint"] == "refresh_token"
        assert kwargs["data"]["client_id"] == "deer-flow"
        assert ("client_secret" in kwargs["data"]) is expected_secret
        if auth_method == "client_secret_basic":
            assert kwargs["headers"]["Authorization"].startswith("Basic ")
        else:
            assert "Authorization" not in kwargs["headers"]
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_oidc_revoke_token_rejects_non_https_endpoint_before_network(monkeypatch):
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint=None,
        jwks_uri="https://issuer.example.com/jwks",
        revocation_endpoint="http://issuer.example.com/revoke",
    )
    post = AsyncMock()
    monkeypatch.setattr(service._http, "post", post)

    try:
        with pytest.raises(OIDCError, match="endpoint must use HTTPS"):
            await service.revoke_token(
                metadata,
                client_id="deer-flow",
                client_secret="client-secret",
                token="opaque-refresh-token",
                token_type_hint="refresh_token",
            )
        post.assert_not_awaited()
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_oidc_revoke_token_error_redacts_token_and_provider_body(monkeypatch):
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint=None,
        jwks_uri="https://issuer.example.com/jwks",
        revocation_endpoint="https://issuer.example.com/revoke",
    )
    request = httpx.Request("POST", metadata.revocation_endpoint)
    response = httpx.Response(503, request=request, text="opaque-refresh-token-echoed")
    post = AsyncMock(side_effect=httpx.HTTPStatusError("provider denied", request=request, response=response))
    monkeypatch.setattr(service._http, "post", post)

    try:
        with pytest.raises(OIDCError) as exc_info:
            await service.revoke_token(
                metadata,
                client_id="deer-flow",
                client_secret="client-secret",
                token="opaque-refresh-token",
                token_type_hint="refresh_token",
            )
        assert str(exc_info.value) == "OIDC token revocation failed: HTTP 503"
        assert "opaque-refresh-token" not in str(exc_info.value)
        assert "client-secret" not in str(exc_info.value)
        assert "echoed" not in str(exc_info.value)
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_oidc_authenticate_callback_treats_string_false_email_verified_as_unverified(monkeypatch):
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint=None,
        jwks_uri="https://issuer.example.com/jwks",
    )

    async def exchange_code(**kwargs):
        return {"id_token": "id-token"}

    async def validate_id_token(**kwargs):
        return {"sub": "subject", "email": "user@example.com", "email_verified": "false"}

    monkeypatch.setattr(service, "exchange_code", exchange_code)
    monkeypatch.setattr(service, "validate_id_token", validate_id_token)

    authentication = await service.authenticate_callback(
        provider_id="keycloak",
        metadata=metadata,
        client_id="deer-flow",
        client_secret=None,
        code="code",
        redirect_uri="https://app.example.com/callback",
    )

    assert authentication.identity.email_verified is False
    await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("id_token_tenant", "userinfo_tenant", "expected_tenant"),
    [
        ("tenant-from-id-token", "tenant-from-userinfo", "tenant-from-id-token"),
        (None, "tenant-from-userinfo", None),
    ],
)
async def test_oidc_callback_uses_only_signed_tenant_claim_for_iam_context(monkeypatch, id_token_tenant, userinfo_tenant, expected_tenant):
    """UserInfo may refresh profile fields but cannot choose the IAM tenant."""
    service = OIDCService()
    metadata = OIDCMetadata(
        issuer="https://issuer.example.com",
        authorization_endpoint="https://issuer.example.com/auth",
        token_endpoint="https://issuer.example.com/token",
        userinfo_endpoint="https://issuer.example.com/userinfo",
        jwks_uri="https://issuer.example.com/jwks",
    )

    async def exchange_code(**kwargs):
        return {
            "id_token": "id-token",
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "expires_in": 900,
            "refresh_expires_in": 3600,
        }

    async def validate_id_token(**kwargs):
        claims = {"sub": "subject", "email": "signed@example.com"}
        if id_token_tenant is not None:
            claims["tenant_id"] = id_token_tenant
        return claims

    async def fetch_userinfo(**kwargs):
        return {
            "sub": "subject",
            "email": "profile@example.com",
            "tenant_id": userinfo_tenant,
        }

    monkeypatch.setattr(service, "exchange_code", exchange_code)
    monkeypatch.setattr(service, "validate_id_token", validate_id_token)
    monkeypatch.setattr(service, "fetch_userinfo", fetch_userinfo)

    try:
        authentication = await service.authenticate_callback(
            provider_id="iam",
            metadata=metadata,
            client_id="deer-flow",
            client_secret=None,
            code="code",
            redirect_uri="https://app.example.com/callback",
        )
        assert authentication.identity.email == "profile@example.com"
        assert authentication.identity.claims.get("tenant_id") == expected_tenant
        assert authentication.access_token == "access-token"
        assert authentication.refresh_token == "refresh-token"
        assert authentication.access_token_expires_in == 900
        assert authentication.refresh_token_expires_in == 3600
        assert "access-token" not in repr(authentication)
        assert "refresh-token" not in repr(authentication)
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_oidc_provision_recovers_existing_user_on_create_race():
    """A concurrent create that loses the unique index re-resolves to the winner's row."""
    created_user = User(email="user@example.com", password_hash=None, oauth_provider="keycloak", oauth_id="subject")
    local_provider = AsyncMock()
    # First lookup (by oauth) misses, then create races and raises, then re-lookup wins.
    local_provider.get_user_by_oauth.side_effect = [None, created_user]
    local_provider.get_user_by_email.return_value = None
    local_provider.create_oauth_user.side_effect = ValueError("Email already registered: user@example.com")

    result = await get_or_provision_oidc_user(
        provider_id="keycloak",
        provider_config=_provider_config(),
        identity=_identity(subject="subject"),
        local_provider=local_provider,
    )

    assert result == {"user": created_user, "created": False}
    assert local_provider.get_user_by_oauth.await_count == 2


@pytest.mark.asyncio
async def test_oidc_provision_create_race_on_email_only_raises_409():
    """A create race that collides on email (different identity) surfaces a clean 409, not a 500."""
    local_provider = AsyncMock()
    # No existing oauth link before or after the race (email collision, not same subject).
    local_provider.get_user_by_oauth.return_value = None
    local_provider.get_user_by_email.return_value = None
    local_provider.create_oauth_user.side_effect = ValueError("Email already registered: user@example.com")

    with pytest.raises(HTTPException) as exc_info:
        await get_or_provision_oidc_user(
            provider_id="keycloak",
            provider_config=_provider_config(),
            identity=_identity(subject="subject"),
            local_provider=local_provider,
        )

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_oidc_discover_rejects_mismatched_issuer(monkeypatch):
    service = OIDCService()

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "issuer": "https://evil.example.com",
                "authorization_endpoint": "https://issuer.example.com/auth",
                "token_endpoint": "https://issuer.example.com/token",
                "jwks_uri": "https://issuer.example.com/jwks",
            }

    async def fake_get(url):
        return _Resp()

    monkeypatch.setattr(service._http, "get", fake_get)

    with pytest.raises(OIDCError, match="does not match configured issuer"):
        await service.discover("https://issuer.example.com")

    await service.close()


@pytest.mark.asyncio
async def test_oidc_discover_accepts_issuer_with_trailing_slash_difference(monkeypatch):
    service = OIDCService()

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "issuer": "https://issuer.example.com/",
                "authorization_endpoint": "https://issuer.example.com/auth",
                "token_endpoint": "https://issuer.example.com/token",
                "jwks_uri": "https://issuer.example.com/jwks",
            }

    async def fake_get(url):
        return _Resp()

    monkeypatch.setattr(service._http, "get", fake_get)

    metadata = await service.discover("https://issuer.example.com")

    assert metadata.issuer == "https://issuer.example.com/"
    await service.close()


def _redirect_request(headers: dict, scheme: str = "http", netloc: str = "localhost:8001"):
    from unittest.mock import MagicMock

    req = MagicMock()
    req.headers = headers
    req.url.scheme = scheme
    req.url.netloc = netloc
    return req


def test_oidc_redirect_uri_prefers_configured_value():
    from app.gateway.routers.auth import _resolve_oidc_redirect_uri

    cfg = _provider_config(redirect_uri="https://app.example.com/api/v1/auth/callback/keycloak")
    req = _redirect_request({"host": "attacker.example.com"})

    assert _resolve_oidc_redirect_uri(req, "keycloak", cfg) == "https://app.example.com/api/v1/auth/callback/keycloak"


def test_oidc_redirect_uri_fallback_uses_forwarded_headers_not_raw_host():
    from app.gateway.routers.auth import _resolve_oidc_redirect_uri

    cfg = _provider_config()
    # Raw Host is attacker-controlled; proxy-set X-Forwarded-* must win.
    req = _redirect_request(
        {
            "host": "attacker.example.com",
            "x-forwarded-host": "app.example.com",
            "x-forwarded-proto": "https",
        }
    )

    result = _resolve_oidc_redirect_uri(req, "keycloak", cfg)

    assert result == "https://app.example.com/api/v1/auth/callback/keycloak"


def test_oidc_redirect_uri_fallback_plain_host_when_no_proxy_headers():
    from app.gateway.routers.auth import _resolve_oidc_redirect_uri

    cfg = _provider_config()
    req = _redirect_request({"host": "localhost:8001"})

    result = _resolve_oidc_redirect_uri(req, "keycloak", cfg)

    assert result == "http://localhost:8001/api/v1/auth/callback/keycloak"
