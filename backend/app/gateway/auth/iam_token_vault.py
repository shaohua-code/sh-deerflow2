"""Encrypted persistent storage for explicitly configured IAM OIDC tokens.

Tokens are encrypted before entering SQLAlchemy and are decrypted only for a
server-side caller that supplies the expected local user and OIDC identity.
This module never logs token material or returns ORM rows to API serializers.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import secrets
import time
from asyncio import CancelledError, Lock
from collections.abc import Awaitable, Callable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Final

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from deerflow.persistence.engine import get_session_factory
from deerflow.persistence.user.model import IamOidcTokenVaultRow

IAM_TOKEN_ENCRYPTION_KEY_ENV: Final[str] = "DEERFLOW_IAM_TOKEN_ENCRYPTION_KEY"
_KEY_BYTES: Final[int] = 32
_NONCE_BYTES: Final[int] = 12
_MAX_TOKEN_BYTES: Final[int] = 16_384
_MAX_ENVELOPE_CHARS: Final[int] = 32_768
_VERSION: Final[str] = "v1"
_CONTEXT_RE: Final[re.Pattern[str]] = re.compile(r"^[^\x00\r\n]{1,512}$")
_TOKEN_PURPOSES: Final[frozenset[str]] = frozenset({"access_token", "refresh_token"})
_RUN_SESSION_REVALIDATE_SECONDS: Final[float] = 2.0
_ACCESS_TOKEN_REFRESH_SKEW_SECONDS: Final[int] = 60


class IamTokenVaultError(ValueError):
    """The key, identity, token, or encrypted vault record is invalid."""


@dataclass(frozen=True)
class IamStoredTokens:
    """Decrypted token material returned only to trusted server callers."""

    access_token: str = field(repr=False)
    refresh_token: str = field(repr=False)
    provider_id: str
    issuer: str
    subject: str
    tenant_id: str
    access_expires_at: datetime
    refresh_expires_at: datetime | None

    def __repr__(self) -> str:
        return "IamStoredTokens(identity=<redacted>, tokens=<redacted>)"


class IamAuthorizationCredentials(Mapping[str, str]):
    """Ephemeral provider input whose representation never prints secrets.

    The object is created only for one in-process authorization operation. It
    intentionally implements ``Mapping`` so the independently packaged IAM
    provider can consume it without importing this Gateway module. Do not put
    it in a response, Agent config, checkpoint, or long-lived cache.
    """

    __slots__ = ("_values", "_access_expires_at", "_resolve_tokens", "_refresh_lock", "_last_resolved_at")

    def __init__(
        self,
        *,
        access_token: str,
        subject: str,
        tenant_id: str,
        access_expires_at: datetime | None = None,
        resolve_tokens: Callable[[], Awaitable[IamStoredTokens | None]] | None = None,
    ) -> None:
        self._values = {
            "iam_access_token": access_token,
            "iam_subject": subject,
            "iam_tenant_id": tenant_id,
        }
        self._access_expires_at = _as_utc(access_expires_at) if isinstance(access_expires_at, datetime) else None
        self._resolve_tokens = resolve_tokens
        self._refresh_lock = Lock()
        # Request auth just resolved this session from the vault. Agent runs
        # force a second check at admission; later checks are single-flight and
        # revalidate the vault row at most once per short interval.
        self._last_resolved_at = time.monotonic()

    def __getitem__(self, key: str) -> str:
        if key == "iam_access_token" and self._access_expires_at is not None:
            if self._access_expires_at <= datetime.now(UTC):
                return ""
        return self._values[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __repr__(self) -> str:
        return "IamAuthorizationCredentials(<redacted>)"

    async def refresh_if_needed(self, *, force: bool = False) -> None:
        """Revalidate the local session and rotate a near-expiry token.

        This capability never returns the refresh token. It updates only the
        in-memory access-token mapping after the vault has rechecked the exact
        user/session/provider/subject tuple. Missing, revoked, or unreadable
        sessions erase the cached access token and fail closed.
        """
        if self._resolve_tokens is None:
            return

        async with self._refresh_lock:
            now_monotonic = time.monotonic()
            now_utc = datetime.now(UTC)
            near_expiry = (
                self._access_expires_at is None
                or self._access_expires_at <= now_utc + timedelta(seconds=_ACCESS_TOKEN_REFRESH_SKEW_SECONDS)
            )
            if (
                not force
                and not near_expiry
                and now_monotonic - self._last_resolved_at < _RUN_SESSION_REVALIDATE_SECONDS
            ):
                return

            try:
                tokens = await self._resolve_tokens()
                if (
                    tokens is None
                    or tokens.subject != self._values["iam_subject"]
                    or tokens.tenant_id != self._values["iam_tenant_id"]
                    or not tokens.access_token
                ):
                    raise IamTokenVaultError("IAM token-vault session is no longer active")
                self._values = {
                    "iam_access_token": tokens.access_token,
                    "iam_subject": tokens.subject,
                    "iam_tenant_id": tokens.tenant_id,
                }
                self._access_expires_at = _as_utc(tokens.access_expires_at)
                self._last_resolved_at = time.monotonic()
            except Exception:
                self._values["iam_access_token"] = ""
                self._access_expires_at = datetime.min.replace(tzinfo=UTC)
                raise IamTokenVaultError("IAM token-vault session could not be revalidated") from None


class IamTokenVaultCipher:
    """AES-256-GCM token envelope cipher with identity-bound associated data."""

    __slots__ = ("_aesgcm",)

    def __init__(self, key: bytes) -> None:
        if not isinstance(key, bytes) or len(key) != _KEY_BYTES:
            raise IamTokenVaultError("IAM token-vault key must be exactly 32 bytes")
        self._aesgcm = AESGCM(key)

    def __repr__(self) -> str:
        return "IamTokenVaultCipher(<redacted>)"

    @classmethod
    def from_environment(cls) -> IamTokenVaultCipher:
        """Load a standard Base64-encoded 32-byte key from the process secret."""
        encoded = os.environ.get(IAM_TOKEN_ENCRYPTION_KEY_ENV, "").strip()
        if not encoded:
            raise IamTokenVaultError(f"{IAM_TOKEN_ENCRYPTION_KEY_ENV} is required for IAM token vaulting")
        try:
            key = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            raise IamTokenVaultError(f"{IAM_TOKEN_ENCRYPTION_KEY_ENV} must be standard Base64") from None
        if len(key) != _KEY_BYTES:
            raise IamTokenVaultError(f"{IAM_TOKEN_ENCRYPTION_KEY_ENV} must decode to exactly 32 bytes")
        return cls(key)

    @staticmethod
    def _associated_data(*, issuer: str, subject: str, tenant_id: str, session_id: str, token_type: str) -> bytes:
        values = (issuer, subject, tenant_id, session_id, token_type)
        if any(not isinstance(value, str) or not _CONTEXT_RE.fullmatch(value) for value in values):
            raise IamTokenVaultError("IAM token-vault identity context is incomplete")
        if token_type not in _TOKEN_PURPOSES:
            raise IamTokenVaultError("IAM token-vault token purpose is invalid")
        return json.dumps(values, ensure_ascii=True, separators=(",", ":")).encode("ascii")

    def encrypt(
        self, token: str, *, issuer: str, subject: str, tenant_id: str, session_id: str, token_type: str
    ) -> str:
        """Encrypt one token and return a versioned URL-safe envelope."""
        if not isinstance(token, str) or not token:
            raise IamTokenVaultError("IAM token is empty or exceeds the supported size")
        try:
            plaintext = token.encode("utf-8", errors="strict")
        except UnicodeEncodeError:
            raise IamTokenVaultError("IAM token is not valid UTF-8") from None
        if len(plaintext) > _MAX_TOKEN_BYTES:
            raise IamTokenVaultError("IAM token is empty or exceeds the supported size")
        aad = self._associated_data(
            issuer=issuer, subject=subject, tenant_id=tenant_id, session_id=session_id, token_type=token_type
        )
        nonce = secrets.token_bytes(_NONCE_BYTES)
        ciphertext = self._aesgcm.encrypt(nonce, plaintext, aad)
        encoded = base64.urlsafe_b64encode(nonce + ciphertext).rstrip(b"=").decode("ascii")
        return f"{_VERSION}.{encoded}"

    def decrypt(
        self, envelope: str, *, issuer: str, subject: str, tenant_id: str, session_id: str, token_type: str
    ) -> str:
        """Decrypt only when the persisted identity context matches the AAD."""
        if (
            not isinstance(envelope, str)
            or len(envelope) > _MAX_ENVELOPE_CHARS
            or not envelope.startswith(f"{_VERSION}.")
        ):
            raise IamTokenVaultError("IAM token-vault envelope is malformed or unsupported")
        aad = self._associated_data(
            issuer=issuer, subject=subject, tenant_id=tenant_id, session_id=session_id, token_type=token_type
        )
        encoded = envelope[len(_VERSION) + 1 :]
        if not encoded or not re.fullmatch(r"[A-Za-z0-9_-]+", encoded):
            raise IamTokenVaultError("IAM token-vault envelope is malformed or unsupported")
        padded = encoded + "=" * (-len(encoded) % 4)
        try:
            combined = base64.b64decode(padded, altchars=b"-_", validate=True)
        except (binascii.Error, ValueError):
            raise IamTokenVaultError("IAM token-vault envelope is malformed or unsupported") from None
        if len(combined) <= _NONCE_BYTES + 16:
            raise IamTokenVaultError("IAM token-vault envelope is malformed or unsupported")
        try:
            plaintext = self._aesgcm.decrypt(combined[:_NONCE_BYTES], combined[_NONCE_BYTES:], aad)
            token = plaintext.decode("utf-8", errors="strict")
        except Exception:
            raise IamTokenVaultError("IAM token-vault authentication failed") from None
        if not token or len(plaintext) > _MAX_TOKEN_BYTES:
            raise IamTokenVaultError("IAM token-vault plaintext is invalid")
        return token


class IamTokenVaultRepository:
    """Persist and resolve encrypted IAM tokens using DeerFlow's async DB."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession], cipher: IamTokenVaultCipher) -> None:
        self._session_factory = session_factory
        self._cipher = cipher

    async def list_session_ids_for_identity(
        self,
        *,
        user_id: str,
        provider_id: str,
        issuer: str,
        subject: str,
        limit: int = 8,
    ) -> list[str]:
        """Return bounded, newest-first session keys for one verified OIDC identity.

        Background scheduled runs have no browser request from which to read a
        signed ``sid``. They may use an existing vault session only after the
        local account's provider/subject and configured issuer match this row;
        the normal token loader then verifies the encrypted row and refreshes
        its credential before IAM authorization.
        """
        if type(limit) is not int or not 1 <= limit <= 32:
            raise ValueError("session lookup limit must be between 1 and 32")
        async with self._session_factory() as session:
            result = await session.scalars(
                select(IamOidcTokenVaultRow.session_id)
                .where(
                    IamOidcTokenVaultRow.user_id == user_id,
                    IamOidcTokenVaultRow.provider_id == provider_id,
                    IamOidcTokenVaultRow.issuer == issuer,
                    IamOidcTokenVaultRow.subject == subject,
                )
                .order_by(IamOidcTokenVaultRow.updated_at.desc(), IamOidcTokenVaultRow.session_id.desc())
                .limit(limit)
            )
            return [sid for sid in result.all() if isinstance(sid, str)]

    async def store(
        self,
        *,
        user_id: str,
        session_id: str,
        provider_id: str,
        issuer: str,
        subject: str,
        tenant_id: str,
        access_token: str,
        refresh_token: str,
        access_expires_in: int,
        refresh_expires_in: int | None,
    ) -> None:
        """Insert or rotate one local session's encrypted token pair atomically."""
        if not isinstance(user_id, str) or not user_id or not isinstance(provider_id, str) or not provider_id:
            raise IamTokenVaultError("IAM token-vault local identity is incomplete")
        if not isinstance(session_id, str) or not re.fullmatch(r"[0-9a-fA-F-]{36}", session_id):
            raise IamTokenVaultError("IAM token-vault session id is invalid")
        if type(access_expires_in) is not int or access_expires_in <= 0:
            raise IamTokenVaultError("IAM access-token lifetime is missing or invalid")
        if refresh_expires_in is not None and (type(refresh_expires_in) is not int or refresh_expires_in <= 0):
            raise IamTokenVaultError("IAM refresh-token lifetime is invalid")

        # Encrypt before opening the DB transaction so SQLAlchemy never sees
        # plaintext and a slow KDF/network call cannot hold a row lock.
        access_envelope = self._cipher.encrypt(
            access_token,
            issuer=issuer,
            subject=subject,
            tenant_id=tenant_id,
            session_id=session_id,
            token_type="access_token",
        )
        refresh_envelope = self._cipher.encrypt(
            refresh_token,
            issuer=issuer,
            subject=subject,
            tenant_id=tenant_id,
            session_id=session_id,
            token_type="refresh_token",
        )
        now = datetime.now(UTC)
        access_expires_at = now + timedelta(seconds=access_expires_in)
        refresh_expires_at = now + timedelta(seconds=refresh_expires_in) if refresh_expires_in is not None else None

        # A concurrent refresh can race on the composite primary key. Retry
        # once so the loser updates the session row after a first insert wins.
        for attempt in range(2):
            try:
                async with self._session_factory() as session, session.begin():
                    row = await session.scalar(
                        select(IamOidcTokenVaultRow)
                        .where(
                            IamOidcTokenVaultRow.user_id == user_id,
                            IamOidcTokenVaultRow.session_id == session_id,
                        )
                        .with_for_update()
                    )
                    if row is None:
                        row = IamOidcTokenVaultRow(
                            user_id=user_id,
                            session_id=session_id,
                            provider_id=provider_id,
                            issuer=issuer,
                            subject=subject,
                            tenant_id=tenant_id,
                            access_token_ciphertext=access_envelope,
                            refresh_token_ciphertext=refresh_envelope,
                            access_expires_at=access_expires_at,
                            refresh_expires_at=refresh_expires_at,
                            created_at=now,
                            updated_at=now,
                        )
                        session.add(row)
                    else:
                        if (row.provider_id, row.issuer, row.subject, row.tenant_id) != (provider_id, issuer, subject, tenant_id):
                            raise IamTokenVaultError("IAM token-vault identity changed; explicit relinking is required")
                        row.access_token_ciphertext = access_envelope
                        row.refresh_token_ciphertext = refresh_envelope
                        row.access_expires_at = access_expires_at
                        row.refresh_expires_at = refresh_expires_at
                        row.updated_at = now
                return
            except IntegrityError:
                if attempt == 1:
                    raise IamTokenVaultError("IAM token-vault storage is unavailable") from None
            except SQLAlchemyError:
                # SQLAlchemy exceptions can expose connection strings or SQL;
                # keep the callback failure safe for logs and redirects.
                raise IamTokenVaultError("IAM token-vault storage is unavailable") from None

    async def load_for_identity(
        self,
        *,
        user_id: str,
        session_id: str,
        provider_id: str,
        issuer: str,
        subject: str,
    ) -> IamStoredTokens | None:
        """Resolve one session only for its exact server-authenticated identity."""
        async with self._session_factory() as session:
            row = await session.get(IamOidcTokenVaultRow, (user_id, session_id))
            if row is None:
                return None
            if (row.provider_id, row.issuer, row.subject) != (provider_id, issuer, subject):
                raise IamTokenVaultError("IAM token-vault identity does not match the authenticated user")
            return self._tokens_from_row(row)

    async def load_or_refresh_for_identity(
        self,
        *,
        user_id: str,
        session_id: str,
        provider_id: str,
        issuer: str,
        subject: str,
        refresh: Callable[[str], Awaitable[object]],
        refresh_before_seconds: int = 60,
    ) -> IamStoredTokens | None:
        """Return a usable token pair and atomically persist refresh rotation.

        The row lock is intentionally held across the remote refresh request.
        IAM refresh grants may be single-use, so serializing this small,
        exceptional path prevents concurrent Gateway requests from consuming
        the same refresh token on multiple workers. Normal access-token reads
        use :meth:`load_for_identity` and do not hold a transaction open.
        """
        if type(refresh_before_seconds) is not int or not 0 <= refresh_before_seconds <= 300:
            raise ValueError("refresh_before_seconds must be between 0 and 300")

        try:
            async with self._session_factory() as session, session.begin():
                row = await session.scalar(
                    select(IamOidcTokenVaultRow)
                    .where(
                        IamOidcTokenVaultRow.user_id == user_id,
                        IamOidcTokenVaultRow.session_id == session_id,
                    )
                    .with_for_update()
                )
                if row is None:
                    return None
                if (row.provider_id, row.issuer, row.subject) != (provider_id, issuer, subject):
                    raise IamTokenVaultError("IAM token-vault identity does not match the authenticated user")

                current = self._tokens_from_row(row)
                now = datetime.now(UTC)
                if current.access_expires_at > now + timedelta(seconds=refresh_before_seconds):
                    return current
                if current.refresh_expires_at is not None and current.refresh_expires_at <= now:
                    raise IamTokenVaultError("IAM refresh token has expired")

                # The callback is expected to return OIDCTokenRefreshResult or
                # an equivalent typed mapping. It is deliberately invoked
                # while the row is locked so token rotation is single-writer.
                response = await refresh(current.refresh_token)
                access_token = _refresh_value(response, "access_token")
                expires_in = _refresh_value(response, "expires_in")
                replacement_refresh_token = _refresh_value(response, "refresh_token")
                refresh_expires_in = _refresh_value(response, "refresh_expires_in")
                if not isinstance(access_token, str) or not access_token or type(expires_in) is not int or expires_in <= 0:
                    raise IamTokenVaultError("IAM refresh response is incomplete")
                if replacement_refresh_token is not None and (
                    not isinstance(replacement_refresh_token, str) or not replacement_refresh_token
                ):
                    raise IamTokenVaultError("IAM refresh response contains an invalid refresh token")
                if refresh_expires_in is not None and (
                    type(refresh_expires_in) is not int or refresh_expires_in <= 0
                ):
                    raise IamTokenVaultError("IAM refresh response contains an invalid refresh lifetime")

                next_refresh_token = replacement_refresh_token or current.refresh_token
                row.access_token_ciphertext = self._cipher.encrypt(
                    access_token,
                    issuer=row.issuer,
                    subject=row.subject,
                    tenant_id=row.tenant_id,
                    session_id=row.session_id,
                    token_type="access_token",
                )
                row.refresh_token_ciphertext = self._cipher.encrypt(
                    next_refresh_token,
                    issuer=row.issuer,
                    subject=row.subject,
                    tenant_id=row.tenant_id,
                    session_id=row.session_id,
                    token_type="refresh_token",
                )
                row.access_expires_at = now + timedelta(seconds=expires_in)
                if refresh_expires_in is not None:
                    row.refresh_expires_at = now + timedelta(seconds=refresh_expires_in)
                row.updated_at = now
                return self._tokens_from_row(row, access_token=access_token, refresh_token=next_refresh_token)
        except IamTokenVaultError:
            raise
        except SQLAlchemyError:
            raise IamTokenVaultError("IAM token-vault storage is unavailable") from None

    def _tokens_from_row(
        self,
        row: IamOidcTokenVaultRow,
        *,
        access_token: str | None = None,
        refresh_token: str | None = None,
    ) -> IamStoredTokens:
        """Decrypt one row after its identity and session key are fixed."""
        return IamStoredTokens(
            access_token=access_token
            or self._cipher.decrypt(
                row.access_token_ciphertext,
                issuer=row.issuer,
                subject=row.subject,
                tenant_id=row.tenant_id,
                session_id=row.session_id,
                token_type="access_token",
            ),
            refresh_token=refresh_token
            or self._cipher.decrypt(
                row.refresh_token_ciphertext,
                issuer=row.issuer,
                subject=row.subject,
                tenant_id=row.tenant_id,
                session_id=row.session_id,
                token_type="refresh_token",
            ),
            provider_id=row.provider_id,
            issuer=row.issuer,
            subject=row.subject,
            tenant_id=row.tenant_id,
            access_expires_at=_as_utc(row.access_expires_at),
            refresh_expires_at=_as_utc(row.refresh_expires_at) if row.refresh_expires_at else None,
        )

    async def delete(self, user_id: str, session_id: str) -> None:
        """Remove one local session's encrypted tokens without exposing them."""
        async with self._session_factory() as session, session.begin():
            row = await session.get(IamOidcTokenVaultRow, (user_id, session_id))
            if row is not None:
                await session.delete(row)

    async def delete_for_user(self, user_id: str) -> None:
        """Remove every vaulted session when the owning account is retired."""
        from sqlalchemy import delete

        async with self._session_factory() as session, session.begin():
            await session.execute(delete(IamOidcTokenVaultRow).where(IamOidcTokenVaultRow.user_id == user_id))


async def load_iam_authorization_attributes(
    *,
    user: object,
    session_id: str | None,
    provider_configs: Mapping[str, object],
    oidc_service: object,
) -> dict[str, IamAuthorizationCredentials]:
    """Resolve a verified browser session to one redacted IAM credential capability.

    The browser JWT contributes only its signed local ``sid``. Provider ID,
    issuer, subject, and tenant are checked against the active local account
    and the encrypted vault row; request headers, query parameters, and client
    runtime config are never consulted.
    """
    provider_id = getattr(user, "oauth_provider", None)
    subject = getattr(user, "oauth_id", None)
    user_id = getattr(user, "id", None)
    if (
        not getattr(user, "is_active", False)
        or not isinstance(user_id, str)
        or not user_id
        or not isinstance(provider_id, str)
        or not provider_id
        or not isinstance(subject, str)
        or not subject
        or not isinstance(session_id, str)
        or not re.fullmatch(r"[0-9a-fA-F-]{36}", session_id)
    ):
        return {}

    provider_config = provider_configs.get(provider_id)
    if (
        provider_config is None
        or getattr(provider_config, "iam_token_vault_enabled", False) is not True
        or "offline_access" not in (getattr(provider_config, "scopes", None) or [])
    ):
        return {}
    issuer = getattr(provider_config, "issuer", None)
    refresh_tokens = getattr(oidc_service, "refresh_tokens", None)
    if not isinstance(issuer, str) or not issuer or not callable(refresh_tokens):
        return {}

    session_factory = get_session_factory()
    if session_factory is None:
        raise IamTokenVaultError("Persistent storage is required for IAM authorization")
    repository = IamTokenVaultRepository(session_factory, IamTokenVaultCipher.from_environment())

    async def refresh(refresh_token: str) -> object:
        return await refresh_tokens(provider_config, refresh_token)

    async def resolve_tokens() -> IamStoredTokens | None:
        """Re-read this exact session and lock only when rotating a token."""
        current = await repository.load_for_identity(
            user_id=user_id,
            session_id=session_id,
            provider_id=provider_id,
            issuer=issuer,
            subject=subject,
        )
        if current is not None and current.access_expires_at <= datetime.now(UTC) + timedelta(
            seconds=_ACCESS_TOKEN_REFRESH_SKEW_SECONDS
        ):
            current = await repository.load_or_refresh_for_identity(
                user_id=user_id,
                session_id=session_id,
                provider_id=provider_id,
                issuer=issuer,
                subject=subject,
                refresh=refresh,
            )
        if current is not None and (
            current.provider_id,
            current.issuer,
            current.subject,
        ) != (provider_id, issuer, subject):
            raise IamTokenVaultError("IAM token-vault identity does not match the authenticated user")
        return current

    tokens = await resolve_tokens()
    if tokens is None:
        return {}

    return {
        "iam_credentials": IamAuthorizationCredentials(
            access_token=tokens.access_token,
            subject=tokens.subject,
            tenant_id=tokens.tenant_id,
            access_expires_at=tokens.access_expires_at,
            resolve_tokens=resolve_tokens,
        )
    }


async def load_active_iam_authorization_attributes(
    *,
    user: object,
    provider_configs: Mapping[str, object],
    oidc_service: object,
) -> dict[str, IamAuthorizationCredentials]:
    """Resolve one currently usable vault session for a background user action.

    This is used only by trusted server-side scheduler code. It never accepts
    a session key from a scheduled-task row, request payload, or client header;
    it enumerates a small set of vault keys bound to the active local account's
    exact configured provider, issuer, and OIDC subject, then uses the same
    identity-checking loader as browser authorization.
    """
    provider_id = getattr(user, "oauth_provider", None)
    subject = getattr(user, "oauth_id", None)
    user_id = getattr(user, "id", None)
    provider_config = provider_configs.get(provider_id) if isinstance(provider_id, str) else None
    issuer = getattr(provider_config, "issuer", None)
    if (
        not isinstance(user_id, str)
        or not user_id
        or not isinstance(provider_id, str)
        or not provider_id
        or not isinstance(subject, str)
        or not subject
        or not getattr(user, "is_active", False)
        or provider_config is None
        or getattr(provider_config, "iam_token_vault_enabled", False) is not True
        or "offline_access" not in (getattr(provider_config, "scopes", None) or [])
        or not isinstance(issuer, str)
        or not issuer
        or not callable(getattr(oidc_service, "refresh_tokens", None))
    ):
        return {}

    session_factory = get_session_factory()
    if session_factory is None:
        raise IamTokenVaultError("Persistent storage is required for IAM authorization")
    try:
        repository = IamTokenVaultRepository(session_factory, IamTokenVaultCipher.from_environment())
        session_ids = await repository.list_session_ids_for_identity(
            user_id=user_id,
            provider_id=provider_id,
            issuer=issuer,
            subject=subject,
        )
    except CancelledError:
        raise
    except Exception:
        raise IamTokenVaultError("IAM token-vault storage is unavailable") from None

    for session_id in session_ids:
        try:
            attributes = await load_iam_authorization_attributes(
                user=user,
                session_id=session_id,
                provider_configs=provider_configs,
                oidc_service=oidc_service,
            )
        except CancelledError:
            raise
        except Exception:
            # A stale or remotely revoked session must not hide a different
            # active browser session for the same exact local OIDC identity.
            continue
        if attributes:
            return attributes
    return {}


def _as_utc(value: datetime) -> datetime:
    """Restore UTC on SQLite timestamps, which do not retain timezone metadata."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _refresh_value(response: object, name: str) -> object | None:
    """Read a typed token response without accepting arbitrary coercions."""
    if isinstance(response, Mapping):
        return response.get(name)
    return getattr(response, name, None)


async def persist_iam_authentication(
    *, user: object, session_id: str, provider_id: str, issuer: str, authentication: object
) -> None:
    """Validate callback identity and persist its tokens only in the encrypted vault."""
    identity = getattr(authentication, "identity", None)
    access_token = getattr(authentication, "access_token", None)
    refresh_token = getattr(authentication, "refresh_token", None)
    access_expires_in = getattr(authentication, "access_token_expires_in", None)
    refresh_expires_in = getattr(authentication, "refresh_token_expires_in", None)
    subject = getattr(identity, "subject", None)
    claims = getattr(identity, "claims", None)
    tenant_id = claims.get("tenant_id") if isinstance(claims, dict) else None

    if (
        not isinstance(subject, str)
        or not isinstance(tenant_id, str)
        or not tenant_id
        or not isinstance(access_token, str)
        or not isinstance(refresh_token, str)
    ):
        raise IamTokenVaultError("IAM callback did not provide a verified tenant and refreshable token pair")

    if (
        getattr(user, "oauth_provider", None) != provider_id
        or getattr(user, "oauth_id", None) != subject
        or not getattr(user, "is_active", False)
    ):
        raise IamTokenVaultError("IAM callback identity does not match the active DeerFlow account")

    session_factory = get_session_factory()
    if session_factory is None:
        raise IamTokenVaultError("Persistent storage is required for IAM token vaulting")

    repository = IamTokenVaultRepository(session_factory, IamTokenVaultCipher.from_environment())
    await repository.store(
        user_id=str(getattr(user, "id")),
        session_id=session_id,
        provider_id=provider_id,
        issuer=issuer,
        subject=subject,
        tenant_id=tenant_id,
        access_token=access_token,
        refresh_token=refresh_token,
        access_expires_in=access_expires_in,
        refresh_expires_in=refresh_expires_in,
    )


async def delete_iam_session(*, user_id: str, session_id: str) -> None:
    """Delete one session row without requiring the encryption key to be available."""
    from sqlalchemy import delete

    session_factory = get_session_factory()
    if session_factory is None:
        return
    async with session_factory() as session, session.begin():
        await session.execute(
            delete(IamOidcTokenVaultRow).where(
                IamOidcTokenVaultRow.user_id == user_id,
                IamOidcTokenVaultRow.session_id == session_id,
            )
        )


