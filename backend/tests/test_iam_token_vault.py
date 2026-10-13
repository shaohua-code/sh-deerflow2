"""Encrypted IAM token-vault unit and SQLite persistence tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.gateway.auth.iam_token_vault import (
    IamAuthorizationCredentials,
    IamTokenVaultCipher,
    IamTokenVaultError,
    IamTokenVaultRepository,
    load_active_iam_authorization_attributes,
    load_iam_authorization_attributes,
)
from app.gateway.deps import get_current_user_from_request
from deerflow.config.auth_config import OIDCProviderConfig
from deerflow.persistence.base import Base
from deerflow.persistence.user.model import IamOidcTokenVaultRow, UserRow

KEY = bytes(range(32))
IDENTITY = {
    "provider_id": "iam",
    "issuer": "https://iam.example.com",
    "subject": "subject-1",
    "tenant_id": "tenant-1",
}
SESSION_ONE = "11111111-1111-4111-8111-111111111111"
SESSION_TWO = "22222222-2222-4222-8222-222222222222"
CIPHER_IDENTITY = {key: IDENTITY[key] for key in ("issuer", "subject", "tenant_id")}


def test_iam_token_vault_cipher_binds_tokens_to_identity_and_purpose():
    cipher = IamTokenVaultCipher(KEY)
    encrypted = cipher.encrypt("opaque-access-token", **CIPHER_IDENTITY, session_id=SESSION_ONE, token_type="access_token")

    assert encrypted.startswith("v1.")
    assert "opaque-access-token" not in encrypted
    assert cipher.decrypt(encrypted, **CIPHER_IDENTITY, session_id=SESSION_ONE, token_type="access_token") == "opaque-access-token"
    with pytest.raises(IamTokenVaultError, match="authentication failed"):
        cipher.decrypt(
            encrypted,
            **(CIPHER_IDENTITY | {"tenant_id": "other-tenant"}),
            session_id=SESSION_ONE,
            token_type="access_token",
        )
    with pytest.raises(IamTokenVaultError, match="authentication failed"):
        cipher.decrypt(encrypted, **CIPHER_IDENTITY, session_id=SESSION_ONE, token_type="refresh_token")
    with pytest.raises(IamTokenVaultError, match="authentication failed"):
        cipher.decrypt(encrypted, **CIPHER_IDENTITY, session_id=SESSION_TWO, token_type="access_token")


def test_iam_token_vault_rejects_invalid_environment_key(monkeypatch):
    monkeypatch.setenv("DEERFLOW_IAM_TOKEN_ENCRYPTION_KEY", "not-base64")
    with pytest.raises(IamTokenVaultError, match="standard Base64"):
        IamTokenVaultCipher.from_environment()


def test_iam_token_vault_config_requires_offline_access_scope():
    values = {
        "display_name": "IAM",
        "issuer": IDENTITY["issuer"],
        "client_id": "deer-flow",
        "iam_token_vault_enabled": True,
    }
    with pytest.raises(ValidationError, match="offline_access"):
        OIDCProviderConfig.model_validate(values)


@pytest.mark.asyncio
async def test_request_iam_credentials_use_signed_session_and_refreshable_vault(monkeypatch):
    provider_config = OIDCProviderConfig(
        display_name="IAM",
        issuer=IDENTITY["issuer"],
        client_id="deer-flow",
        scopes=["openid", "offline_access"],
        iam_token_vault_enabled=True,
    )
    stored = SimpleNamespace(
        provider_id=IDENTITY["provider_id"],
        issuer=IDENTITY["issuer"],
        subject=IDENTITY["subject"],
        tenant_id=IDENTITY["tenant_id"],
        access_token="soon-to-expire-access-secret",
        access_expires_at=datetime.now(UTC) + timedelta(seconds=30),
    )
    rotated = SimpleNamespace(
        provider_id=IDENTITY["provider_id"],
        issuer=IDENTITY["issuer"],
        subject=IDENTITY["subject"],
        tenant_id=IDENTITY["tenant_id"],
        access_token="rotated-access-secret",
        access_expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    refreshed = SimpleNamespace(
        provider_id=IDENTITY["provider_id"],
        issuer=IDENTITY["issuer"],
        subject=IDENTITY["subject"],
        tenant_id=IDENTITY["tenant_id"],
        access_token="refreshed-run-access-secret",
        access_expires_at=datetime.now(UTC) + timedelta(minutes=10),
    )

    class FakeRepository:
        def __init__(self):
            self.current = stored

        async def load_for_identity(self, **kwargs):
            assert kwargs["user_id"] == "user-1"
            assert kwargs["session_id"] == SESSION_ONE
            assert kwargs["provider_id"] == IDENTITY["provider_id"]
            assert kwargs["issuer"] == IDENTITY["issuer"]
            assert kwargs["subject"] == IDENTITY["subject"]
            return self.current

        async def load_or_refresh_for_identity(self, **kwargs):
            assert kwargs["user_id"] == "user-1"
            assert kwargs["session_id"] == SESSION_ONE
            assert kwargs["provider_id"] == IDENTITY["provider_id"]
            assert kwargs["issuer"] == IDENTITY["issuer"]
            assert kwargs["subject"] == IDENTITY["subject"]
            await kwargs["refresh"]("stored-refresh-secret")
            self.current = rotated
            return rotated

    repository = FakeRepository()
    monkeypatch.setattr("app.gateway.auth.iam_token_vault.get_session_factory", lambda: object())
    monkeypatch.setattr(IamTokenVaultCipher, "from_environment", classmethod(lambda cls: object()))
    monkeypatch.setattr("app.gateway.auth.iam_token_vault.IamTokenVaultRepository", lambda *_: repository)
    user = SimpleNamespace(
        id="user-1",
        is_active=True,
        oauth_provider=IDENTITY["provider_id"],
        oauth_id=IDENTITY["subject"],
    )
    oidc_service = SimpleNamespace(refresh_tokens=AsyncMock(return_value=SimpleNamespace()))

    attributes = await load_iam_authorization_attributes(
        user=user,
        session_id=SESSION_ONE,
        provider_configs={IDENTITY["provider_id"]: provider_config},
        oidc_service=oidc_service,
    )

    credential_context = attributes["iam_credentials"]
    assert isinstance(credential_context, IamAuthorizationCredentials)
    assert credential_context["iam_access_token"] == "rotated-access-secret"
    assert credential_context["iam_subject"] == IDENTITY["subject"]
    assert credential_context["iam_tenant_id"] == IDENTITY["tenant_id"]
    assert "rotated-access-secret" not in repr(credential_context)
    assert "rotated-access-secret" not in repr(attributes)
    oidc_service.refresh_tokens.assert_awaited_once_with(provider_config, "stored-refresh-secret")

    # Long-running Agent checks re-read the exact session and update only the
    # in-memory access token after the vault returns a newer credential pair.
    repository.current = refreshed
    await credential_context.refresh_if_needed(force=True)
    assert credential_context["iam_access_token"] == "refreshed-run-access-secret"
    assert "refreshed-run-access-secret" not in repr(credential_context)

    # Local logout deletes the vault row. The run capability then erases its
    # cached bearer and cannot continue authorizing with the old token.
    repository.current = None
    with pytest.raises(IamTokenVaultError, match="could not be revalidated"):
        await credential_context.refresh_if_needed(force=True)
    assert credential_context["iam_access_token"] == ""


@pytest.mark.asyncio
async def test_request_iam_credentials_reject_missing_or_untrusted_session_before_database(monkeypatch):
    def database():
        raise AssertionError("untrusted sessions must not reach storage")

    monkeypatch.setattr("app.gateway.auth.iam_token_vault.get_session_factory", database)
    provider_config = OIDCProviderConfig(
        display_name="IAM",
        issuer=IDENTITY["issuer"],
        client_id="deer-flow",
        scopes=["openid", "offline_access"],
        iam_token_vault_enabled=True,
    )
    user = SimpleNamespace(
        id="user-1",
        is_active=True,
        oauth_provider=IDENTITY["provider_id"],
        oauth_id=IDENTITY["subject"],
    )

    assert (
        await load_iam_authorization_attributes(
            user=user,
            session_id="client-controlled-value",
            provider_configs={IDENTITY["provider_id"]: provider_config},
            oidc_service=SimpleNamespace(),
        )
        == {}
    )


@pytest.mark.asyncio
async def test_background_iam_credentials_try_only_sessions_for_exact_active_identity(monkeypatch):
    provider_config = OIDCProviderConfig(
        display_name="IAM",
        issuer=IDENTITY["issuer"],
        client_id="deer-flow",
        scopes=["openid", "offline_access"],
        iam_token_vault_enabled=True,
    )
    user = SimpleNamespace(
        id="user-1",
        is_active=True,
        oauth_provider=IDENTITY["provider_id"],
        oauth_id=IDENTITY["subject"],
    )
    credential = IamAuthorizationCredentials(
        access_token="in-memory-access",
        subject=IDENTITY["subject"],
        tenant_id=IDENTITY["tenant_id"],
        access_expires_at=datetime.now(UTC) + timedelta(minutes=5),
        resolve_tokens=AsyncMock(),
    )

    class FakeRepository:
        async def list_session_ids_for_identity(self, **kwargs):
            assert kwargs == {
                "user_id": "user-1",
                "provider_id": IDENTITY["provider_id"],
                "issuer": IDENTITY["issuer"],
                "subject": IDENTITY["subject"],
            }
            return [SESSION_ONE, SESSION_TWO]

    monkeypatch.setattr("app.gateway.auth.iam_token_vault.get_session_factory", lambda: object())
    monkeypatch.setattr(IamTokenVaultCipher, "from_environment", classmethod(lambda cls: object()))
    monkeypatch.setattr("app.gateway.auth.iam_token_vault.IamTokenVaultRepository", lambda *_: FakeRepository())
    attempted_sessions = []

    async def resolve_one_session(**kwargs):
        attempted_sessions.append(kwargs["session_id"])
        if kwargs["session_id"] == SESSION_ONE:
            raise IamTokenVaultError("stale session")
        return {"iam_credentials": credential}

    monkeypatch.setattr("app.gateway.auth.iam_token_vault.load_iam_authorization_attributes", resolve_one_session)
    provider_configs = {IDENTITY["provider_id"]: provider_config}

    attributes = await load_active_iam_authorization_attributes(
        user=user,
        provider_configs=provider_configs,
        oidc_service=SimpleNamespace(refresh_tokens=AsyncMock()),
    )

    assert attempted_sessions == [SESSION_ONE, SESSION_TWO]
    assert attributes["iam_credentials"] is credential
    inactive_user = SimpleNamespace(**(vars(user) | {"is_active": False}))
    monkeypatch.setattr(
        "app.gateway.auth.iam_token_vault.get_session_factory",
        lambda: pytest.fail("inactive accounts must not enumerate token-vault sessions"),
    )
    assert (
        await load_active_iam_authorization_attributes(
            user=inactive_user,
            provider_configs=provider_configs,
            oidc_service=SimpleNamespace(refresh_tokens=AsyncMock()),
        )
        == {}
    )


@pytest.mark.asyncio
async def test_authenticated_local_cookie_exposes_only_signed_session_lookup_key(monkeypatch):
    from app.gateway.auth.jwt import TokenPayload

    user = SimpleNamespace(id="user-1", is_active=True, token_version=0)
    provider = SimpleNamespace(get_user=AsyncMock(return_value=user))
    payload = TokenPayload(
        sub="user-1",
        exp=datetime.now(UTC) + timedelta(minutes=5),
        ver=0,
        sid=SESSION_ONE,
    )
    request = SimpleNamespace(state=SimpleNamespace(), cookies={"access_token": "local-signed-cookie"})
    monkeypatch.setattr("app.gateway.auth.decode_token", lambda _: payload)
    monkeypatch.setattr("app.gateway.deps.get_local_provider", lambda: provider)

    resolved = await get_current_user_from_request(request)

    assert resolved is user
    assert request.state.iam_session_id == SESSION_ONE
    assert "access_token" not in vars(request.state)


@pytest.mark.asyncio
async def test_iam_token_vault_persists_only_ciphertext_and_checks_identity(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'iam-token-vault.db'}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(
                lambda sync_connection: Base.metadata.create_all(
                    sync_connection,
                    tables=[UserRow.__table__, IamOidcTokenVaultRow.__table__],
                )
            )
        async with session_factory() as session, session.begin():
            session.add(
                UserRow(
                    id="user-1",
                    email="iam-user@example.com",
                    password_hash=None,
                    system_role="user",
                    created_at=datetime.now(UTC),
                    oauth_provider="iam",
                    oauth_id="subject-1",
                    needs_setup=False,
                    token_version=0,
                    is_active=True,
                )
            )

        repository = IamTokenVaultRepository(session_factory, IamTokenVaultCipher(KEY))
        await repository.store(
            user_id="user-1",
            session_id=SESSION_ONE,
            **IDENTITY,
            access_token="access-token-one",
            refresh_token="refresh-token-one",
            access_expires_in=900,
            refresh_expires_in=3600,
        )

        async with session_factory() as session:
            row = await session.get(IamOidcTokenVaultRow, ("user-1", SESSION_ONE))
        assert row is not None
        assert "access-token-one" not in row.access_token_ciphertext
        assert "refresh-token-one" not in row.refresh_token_ciphertext
        assert "access-token-one" not in repr(row)
        assert "refresh-token-one" not in repr(row)
        assert "access_token_ciphertext" not in row.to_dict()
        assert "refresh_token_ciphertext" not in row.to_dict()

        tokens = await repository.load_for_identity(
            user_id="user-1",
            session_id=SESSION_ONE,
            provider_id="iam",
            issuer=IDENTITY["issuer"],
            subject=IDENTITY["subject"],
        )
        assert tokens is not None
        assert tokens.access_token == "access-token-one"
        assert tokens.refresh_token == "refresh-token-one"
        assert tokens.tenant_id == IDENTITY["tenant_id"]
        assert "access-token-one" not in repr(tokens)
        assert tokens.access_expires_at.tzinfo == UTC

        with pytest.raises(IamTokenVaultError, match="does not match"):
            await repository.load_for_identity(
                user_id="user-1",
                session_id=SESSION_ONE,
                provider_id="other-provider",
                issuer=IDENTITY["issuer"],
                subject=IDENTITY["subject"],
            )

        await repository.store(
            user_id="user-1",
            session_id=SESSION_ONE,
            **IDENTITY,
            access_token="access-token-two",
            refresh_token="refresh-token-two",
            access_expires_in=1200,
            refresh_expires_in=4800,
        )
        rotated = await repository.load_for_identity(
            user_id="user-1",
            session_id=SESSION_ONE,
            provider_id="iam",
            issuer=IDENTITY["issuer"],
            subject=IDENTITY["subject"],
        )
        assert rotated is not None
        assert rotated.access_token == "access-token-two"
        assert rotated.refresh_token == "refresh-token-two"

        await repository.store(
            user_id="user-1",
            session_id=SESSION_TWO,
            **IDENTITY,
            access_token="access-token-second-session",
            refresh_token="refresh-token-second-session",
            access_expires_in=900,
            refresh_expires_in=3600,
        )
        second_session = await repository.load_for_identity(
            user_id="user-1",
            session_id=SESSION_TWO,
            provider_id="iam",
            issuer=IDENTITY["issuer"],
            subject=IDENTITY["subject"],
        )
        assert second_session is not None
        assert second_session.refresh_token == "refresh-token-second-session"

        await repository.delete("user-1", SESSION_ONE)
        assert (
            await repository.load_for_identity(
                user_id="user-1",
                session_id=SESSION_ONE,
                provider_id="iam",
                issuer=IDENTITY["issuer"],
                subject=IDENTITY["subject"],
            )
            is None
        )
        assert (
            await repository.load_for_identity(
                user_id="user-1",
                session_id=SESSION_TWO,
                provider_id="iam",
                issuer=IDENTITY["issuer"],
                subject=IDENTITY["subject"],
            )
            is not None
        )
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_iam_token_vault_refreshes_expired_access_token_and_persists_rotation(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'iam-token-refresh.db'}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(
                lambda sync_connection: Base.metadata.create_all(
                    sync_connection,
                    tables=[UserRow.__table__, IamOidcTokenVaultRow.__table__],
                )
            )
        async with session_factory() as session, session.begin():
            session.add(
                UserRow(
                    id="user-1",
                    email="iam-user@example.com",
                    password_hash=None,
                    system_role="user",
                    created_at=datetime.now(UTC),
                    oauth_provider="iam",
                    oauth_id="subject-1",
                    needs_setup=False,
                    token_version=0,
                    is_active=True,
                )
            )

        repository = IamTokenVaultRepository(session_factory, IamTokenVaultCipher(KEY))
        await repository.store(
            user_id="user-1",
            session_id=SESSION_ONE,
            **IDENTITY,
            access_token="expired-access",
            refresh_token="refresh-before-rotation",
            access_expires_in=900,
            refresh_expires_in=3600,
        )
        async with session_factory() as session, session.begin():
            row = await session.get(IamOidcTokenVaultRow, ("user-1", SESSION_ONE))
            assert row is not None
            row.access_expires_at = datetime.now(UTC) - timedelta(seconds=1)

        calls: list[str] = []

        async def refresh(token: str) -> dict[str, object]:
            calls.append(token)
            return {
                "access_token": "fresh-access",
                "expires_in": 900,
                "refresh_token": "refresh-after-rotation",
                "refresh_expires_in": 7200,
            }

        refreshed = await repository.load_or_refresh_for_identity(
            user_id="user-1",
            session_id=SESSION_ONE,
            provider_id="iam",
            issuer=IDENTITY["issuer"],
            subject=IDENTITY["subject"],
            refresh=refresh,
        )
        assert refreshed is not None
        assert refreshed.access_token == "fresh-access"
        assert refreshed.refresh_token == "refresh-after-rotation"
        assert calls == ["refresh-before-rotation"]

        # A follow-up request observes the committed token rotation and does
        # not replay the now-consumed refresh token.
        async def unexpected_refresh(_: str) -> dict[str, object]:
            pytest.fail("fresh access token should not trigger another refresh")

        current = await repository.load_or_refresh_for_identity(
            user_id="user-1",
            session_id=SESSION_ONE,
            provider_id="iam",
            issuer=IDENTITY["issuer"],
            subject=IDENTITY["subject"],
            refresh=unexpected_refresh,
        )
        assert current is not None
        assert current.access_token == "fresh-access"
        assert current.refresh_token == "refresh-after-rotation"
        async with session_factory() as session:
            row = await session.get(IamOidcTokenVaultRow, ("user-1", SESSION_ONE))
        assert row is not None
        assert "fresh-access" not in row.access_token_ciphertext
        assert "refresh-after-rotation" not in row.refresh_token_ciphertext
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_iam_token_vault_does_not_refresh_another_identity_or_expired_refresh_token(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'iam-token-refresh-deny.db'}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(
                lambda sync_connection: Base.metadata.create_all(
                    sync_connection,
                    tables=[UserRow.__table__, IamOidcTokenVaultRow.__table__],
                )
            )
        async with session_factory() as session, session.begin():
            session.add(
                UserRow(
                    id="user-1",
                    email="iam-user@example.com",
                    password_hash=None,
                    system_role="user",
                    created_at=datetime.now(UTC),
                    oauth_provider="iam",
                    oauth_id="subject-1",
                    needs_setup=False,
                    token_version=0,
                    is_active=True,
                )
            )
        repository = IamTokenVaultRepository(session_factory, IamTokenVaultCipher(KEY))
        await repository.store(
            user_id="user-1",
            session_id=SESSION_ONE,
            **IDENTITY,
            access_token="expired-access",
            refresh_token="expired-refresh",
            access_expires_in=900,
            refresh_expires_in=3600,
        )
        async with session_factory() as session, session.begin():
            row = await session.get(IamOidcTokenVaultRow, ("user-1", SESSION_ONE))
            assert row is not None
            row.access_expires_at = datetime.now(UTC) - timedelta(seconds=1)

        async def unexpected_refresh(_: str) -> dict[str, object]:
            pytest.fail("identity mismatch must be rejected before refresh")

        with pytest.raises(IamTokenVaultError, match="does not match"):
            await repository.load_or_refresh_for_identity(
                user_id="user-1",
                session_id=SESSION_ONE,
                provider_id="other-provider",
                issuer=IDENTITY["issuer"],
                subject=IDENTITY["subject"],
                refresh=unexpected_refresh,
            )

        async with session_factory() as session, session.begin():
            row = await session.get(IamOidcTokenVaultRow, ("user-1", SESSION_ONE))
            assert row is not None
            row.refresh_expires_at = datetime.now(UTC) - timedelta(seconds=1)

        with pytest.raises(IamTokenVaultError, match="refresh token has expired"):
            await repository.load_or_refresh_for_identity(
                user_id="user-1",
                session_id=SESSION_ONE,
                provider_id="iam",
                issuer=IDENTITY["issuer"],
                subject=IDENTITY["subject"],
                refresh=unexpected_refresh,
            )
    finally:
        await engine.dispose()
