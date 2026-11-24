"""OIDC (OpenID Connect) authentication service.

Provides provider-agnostic OIDC operations: discovery, authorization URL
generation, token exchange, ID token validation, and userinfo retrieval.
"""

from __future__ import annotations

import base64
import logging
import re
import secrets
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote_plus, urlencode, urlsplit

import httpx
import jwt
from jwt import PyJWK

logger = logging.getLogger(__name__)

# ── Data types ────────────────────────────────────────────────────────────

OIDC_DISCOVERY_PATH = "/.well-known/openid-configuration"
METADATA_CACHE_TTL = 300  # 5 minutes
JWKS_CACHE_TTL = 300


@dataclass(frozen=True)
class OIDCMetadata:
    """Resolved OIDC provider metadata after discovery."""

    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    userinfo_endpoint: str | None
    jwks_uri: str
    revocation_endpoint: str | None = None


@dataclass(frozen=True)
class OIDCIdentity:
    """Normalized identity extracted from an OIDC provider response."""

    provider: str
    subject: str
    email: str
    email_verified: bool
    name: str | None
    claims: dict[str, Any]


@dataclass(frozen=True)
class OIDCAuthenticationResult:
    """Verified identity plus backend-only tokens returned by the code flow.

    The Gateway can persist tokens in an encrypted server-side vault without
    putting them in the browser session or Agent runtime context. Token fields
    are excluded from the generated representation so accidental object
    logging cannot reveal credentials.
    """

    identity: OIDCIdentity
    access_token: str | None = field(default=None, repr=False)
    refresh_token: str | None = field(default=None, repr=False)
    access_token_expires_in: int | None = None
    refresh_token_expires_in: int | None = None

    def __repr__(self) -> str:
        return "OIDCAuthenticationResult(identity=<redacted>, tokens=<redacted>)"


@dataclass(frozen=True)
class OIDCTokenRefreshResult:
    """Backend-only token response returned by a refresh-token grant."""

    access_token: str = field(repr=False)
    expires_in: int
    refresh_token: str | None = field(default=None, repr=False)
    refresh_expires_in: int | None = None

    def __repr__(self) -> str:
        return "OIDCTokenRefreshResult(tokens=<redacted>)"


class OIDCError(Exception):
    """Base error for OIDC operations. Message is safe for API responses."""


class OIDCProviderError(OIDCError):
    """The OIDC provider returned an error (e.g. access_denied)."""

    def __init__(self, message: str, status_code: int | None = None, error_code: str | None = None) -> None:
        super().__init__(message)
        # Optional upstream HTTP status (e.g. 429 rate limit) so callers can
        # pass through backoff semantics without parsing provider text.
        self.status_code = status_code
        # Optional OAuth ``error`` code (a fixed enumeration such as
        # ``invalid_grant``). It lets callers tell credential failures apart
        # from client/configuration rejections without echoing provider text.
        self.error_code = error_code


class OIDCValidationError(OIDCError):
    """ID token validation failed."""


class OIDCUserInfoMismatch(OIDCError):
    """UserInfo sub is missing or does not match the ID token sub."""


def _oauth_error_code(response: httpx.Response) -> str | None:
    """Extract the OAuth ``error`` code from a provider error response.

    Only a short snake_case token is kept: the ``error`` field is a fixed
    enumeration, unlike ``error_description``, which may quote submitted
    credentials or account identifiers and is therefore never read.
    """
    try:
        payload = response.json()
    except ValueError:
        return None
    code = payload.get("error") if isinstance(payload, dict) else None
    return code if isinstance(code, str) and re.fullmatch(r"[a-z_]{1,64}", code) else None


# ── Service ────────────────────────────────────────────────────────────────


class OIDCService:
    """OIDC authentication service.

    Uses in-process caching for provider metadata and JWKS. The cache is
    keyed by the provider's ``issuer`` — different providers get separate
    entries. TTLs are configurable via constructor arguments.
    """

    def __init__(
        self,
        metadata_cache_ttl: float = METADATA_CACHE_TTL,
        jwks_cache_ttl: float = JWKS_CACHE_TTL,
    ) -> None:
        self._metadata_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._jwks_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._metadata_ttl = metadata_cache_ttl
        self._jwks_ttl = jwks_cache_ttl
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(15.0))

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._http.aclose()

    # ── Discovery ──────────────────────────────────────────────────────────

    async def discover(self, issuer: str, overrides: dict[str, str | None] | None = None) -> OIDCMetadata:
        """Fetch and cache OIDC discovery metadata from the issuer.

        ``overrides`` may contain endpoint URIs to override discovery values
        (e.g. for providers with non-standard endpoints).
        """
        now = time.time()
        cached = self._metadata_cache.get(issuer)
        if cached and now - cached[0] < self._metadata_ttl:
            return self._metadata_from_dict(cached[1], overrides)

        discovery_url = issuer.rstrip("/") + OIDC_DISCOVERY_PATH
        try:
            resp = await self._http.get(discovery_url)
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
        except httpx.HTTPStatusError as exc:
            raise OIDCError(f"OIDC discovery failed for issuer {issuer}: HTTP {exc.response.status_code}") from exc
        except httpx.RequestError as exc:
            raise OIDCError(f"OIDC discovery failed for issuer {issuer}: {exc}") from exc

        discovered_issuer = data.get("issuer")
        if not discovered_issuer:
            raise OIDCError(f"OIDC discovery response from {issuer} is missing the issuer field")

        # RFC 8414 §4: the metadata issuer must equal the configured issuer.
        # Pinning it prevents a tampered/rogue discovery document from steering
        # the accepted `iss` (and thus the ID-token forgery surface) to an
        # attacker-chosen value.
        if discovered_issuer.rstrip("/") != issuer.rstrip("/"):
            raise OIDCError(f"OIDC discovered issuer '{discovered_issuer}' does not match configured issuer '{issuer}'")

        self._metadata_cache[issuer] = (now, data)
        return self._metadata_from_dict(data, overrides)

    def _metadata_from_dict(self, data: dict[str, Any], overrides: dict[str, str | None] | None) -> OIDCMetadata:
        """Build OIDCMetadata from a discovery dict, applying endpoint overrides."""
        overrides = overrides or {}
        return OIDCMetadata(
            issuer=data["issuer"],
            authorization_endpoint=overrides.get("authorization_endpoint") or data["authorization_endpoint"],
            token_endpoint=overrides.get("token_endpoint") or data["token_endpoint"],
            userinfo_endpoint=overrides.get("userinfo_endpoint") or data.get("userinfo_endpoint"),
            jwks_uri=overrides.get("jwks_uri") or data["jwks_uri"],
            revocation_endpoint=overrides.get("revocation_endpoint") or data.get("revocation_endpoint"),
        )

    # ── Authorization URL ──────────────────────────────────────────────────

    def build_authorization_url(
        self,
        metadata: OIDCMetadata,
        client_id: str,
        redirect_uri: str,
        scopes: list[str],
        state: str,
        nonce: str | None = None,
        code_challenge: str | None = None,
    ) -> str:
        """Build the OIDC authorization URL for the provider.

        Returns a URL the browser should be redirected to.
        """
        params: dict[str, str] = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": " ".join(scopes),
            "state": state,
        }
        if nonce:
            params["nonce"] = nonce
        if code_challenge:
            params["code_challenge"] = code_challenge
            params["code_challenge_method"] = "S256"

        return f"{metadata.authorization_endpoint}?{urlencode(params)}"

    # ── Token exchange ─────────────────────────────────────────────────────

    async def exchange_code(
        self,
        metadata: OIDCMetadata,
        client_id: str,
        client_secret: str | None,
        code: str,
        redirect_uri: str,
        code_verifier: str | None = None,
        auth_method: str = "client_secret_post",
    ) -> dict[str, Any]:
        """Exchange the authorization code for tokens at the token endpoint."""
        data: dict[str, str] = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        }
        if code_verifier:
            data["code_verifier"] = code_verifier

        headers: dict[str, str] = {"Accept": "application/json"}
        self._apply_client_auth(data, headers, client_id=client_id, client_secret=client_secret, auth_method=auth_method)

        try:
            resp = await self._http.post(metadata.token_endpoint, data=data, headers=headers)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            body = "unknown"
            try:
                body = exc.response.text[:200]
            except Exception:
                pass
            raise OIDCError(f"Token exchange failed: HTTP {exc.response.status_code} — {body}") from exc
        except httpx.RequestError as exc:
            raise OIDCError(f"Token exchange failed: {exc}") from exc

    @staticmethod
    def _apply_client_auth(
        data: dict[str, str],
        headers: dict[str, str],
        *,
        client_id: str,
        client_secret: str | None,
        auth_method: str,
    ) -> None:
        """Attach client authentication to a token-endpoint request.

        ``client_secret_basic``: credentials travel only in the Authorization
        header (form-encoded first, as RFC 6749 §2.3.1 requires) and the body
        carries neither ``client_id`` nor ``client_secret``. Strict providers —
        the central IAM token endpoint among them — reject a request that adds
        a body ``client_id`` next to Basic auth as ``invalid_request``.
        Any other method keeps the previous body behaviour: ``client_id`` is
        always sent and ``client_secret_post`` adds the secret.
        """
        if auth_method == "client_secret_basic" and client_secret:
            user_name = quote_plus(client_id, safe="")
            password = quote_plus(client_secret, safe="")
            creds = base64.b64encode(f"{user_name}:{password}".encode()).decode("ascii")
            headers["Authorization"] = f"Basic {creds}"
            return
        data["client_id"] = client_id
        if auth_method == "client_secret_post" and client_secret:
            data["client_secret"] = client_secret

    async def request_password_token(
        self,
        metadata: OIDCMetadata,
        client_id: str,
        client_secret: str | None,
        username: str,
        password: str,
        scope: str,
        auth_method: str = "client_secret_post",
    ) -> dict[str, Any]:
        """Request tokens via the resource-owner password credentials grant.

        ROPC is OAuth 2.1-removed and only appropriate for deployment-trusted
        first-party apps whose own login page collects credentials. Provider
        rejections (invalid_grant, rate_limited, …) raise ``OIDCProviderError``
        with the upstream status and OAuth error code attached so the router
        can preserve 429 backoff, fold credential failures into one generic
        message, and report client/configuration rejections as such.
        """
        data: dict[str, str] = {
            "grant_type": "password",
            "username": username,
            "password": password,
            "scope": scope,
        }
        headers: dict[str, str] = {"Accept": "application/json"}
        self._apply_client_auth(data, headers, client_id=client_id, client_secret=client_secret, auth_method=auth_method)

        try:
            resp = await self._http.post(metadata.token_endpoint, data=data, headers=headers)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            # Never echo provider text: it may quote submitted credentials or
            # account identifiers. The upstream status and OAuth error code are
            # all callers need.
            raise OIDCProviderError(
                f"Password grant failed: HTTP {exc.response.status_code}",
                status_code=exc.response.status_code,
                error_code=_oauth_error_code(exc.response),
            ) from None
        except httpx.RequestError as exc:
            raise OIDCError(f"Password grant failed: {exc}") from exc

    async def refresh_tokens(
        self,
        metadata: OIDCMetadata,
        client_id: str,
        client_secret: str | None,
        refresh_token: str,
        auth_method: str = "client_secret_post",
    ) -> OIDCTokenRefreshResult:
        """Rotate an OIDC token pair without logging provider response bodies.

        Refresh responses can contain replacement credentials. Unlike the
        interactive code exchange, this method is used during authorization
        checks, so errors must not include response text that might echo tokens.
        """
        if not isinstance(refresh_token, str) or not refresh_token:
            raise OIDCError("OIDC refresh token is unavailable")

        data = {"grant_type": "refresh_token", "refresh_token": refresh_token}
        headers: dict[str, str] = {"Accept": "application/json"}
        # 与授权码兑换、密码授权共用客户端认证：Basic 模式下表单不再携带 client_id。
        self._apply_client_auth(data, headers, client_id=client_id, client_secret=client_secret, auth_method=auth_method)

        try:
            response = await self._http.post(metadata.token_endpoint, data=data, headers=headers)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise OIDCError(f"OIDC token refresh failed: HTTP {exc.response.status_code}") from None
        except (httpx.RequestError, ValueError):
            raise OIDCError("OIDC token refresh failed") from None

        if not isinstance(payload, dict):
            raise OIDCError("OIDC token refresh response is invalid")
        access_token = payload.get("access_token")
        expires_in = payload.get("expires_in")
        rotated_refresh_token = payload.get("refresh_token")
        refresh_expires_in = payload.get("refresh_expires_in")
        if not isinstance(access_token, str) or not access_token or type(expires_in) is not int or expires_in <= 0:
            raise OIDCError("OIDC token refresh response is incomplete")
        if rotated_refresh_token is not None and (not isinstance(rotated_refresh_token, str) or not rotated_refresh_token):
            raise OIDCError("OIDC token refresh response contains an invalid refresh token")
        if refresh_expires_in is not None and (type(refresh_expires_in) is not int or refresh_expires_in <= 0):
            raise OIDCError("OIDC token refresh response contains an invalid refresh lifetime")

        return OIDCTokenRefreshResult(
            access_token=access_token,
            expires_in=expires_in,
            refresh_token=rotated_refresh_token,
            refresh_expires_in=refresh_expires_in,
        )

    async def revoke_token(
        self,
        metadata: OIDCMetadata,
        client_id: str,
        client_secret: str | None,
        token: str,
        token_type_hint: str,
        auth_method: str = "client_secret_post",
    ) -> None:
        """Revoke one backend-held token without exposing credentials in errors.

        RFC 7009 requires TLS for token revocation. Provider metadata can be
        configured by an operator, so validate the endpoint here as well as
        relying on discovery. An absent optional endpoint is a no-op.
        """
        endpoint = metadata.revocation_endpoint
        if endpoint is None:
            return
        if not isinstance(token, str) or not token:
            raise OIDCError("OIDC token revocation token is unavailable")
        if token_type_hint not in {"access_token", "refresh_token"}:
            raise OIDCError("OIDC token revocation type hint is unsupported")

        try:
            parsed_endpoint = urlsplit(endpoint)
            if parsed_endpoint.scheme != "https" or not parsed_endpoint.hostname or parsed_endpoint.port == 0 or parsed_endpoint.username is not None or parsed_endpoint.password is not None or parsed_endpoint.fragment:
                raise ValueError
        except (TypeError, ValueError):
            raise OIDCError("OIDC token revocation endpoint must use HTTPS") from None

        data = {"token": token, "token_type_hint": token_type_hint, "client_id": client_id}
        headers: dict[str, str] = {"Accept": "application/json"}
        if auth_method == "client_secret_basic":
            if not client_secret:
                raise OIDCError("OIDC client credentials are unavailable for token revocation")
            import base64

            form_client_id = quote_plus(client_id, safe="")
            form_client_secret = quote_plus(client_secret, safe="")
            creds = base64.b64encode(f"{form_client_id}:{form_client_secret}".encode()).decode("ascii")
            headers["Authorization"] = f"Basic {creds}"
        elif auth_method == "client_secret_post":
            if not client_secret:
                raise OIDCError("OIDC client credentials are unavailable for token revocation")
            data["client_secret"] = client_secret
        elif auth_method != "none":
            raise OIDCError("OIDC token revocation client authentication method is unsupported")

        try:
            response = await self._http.post(endpoint, data=data, headers=headers)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise OIDCError(f"OIDC token revocation failed: HTTP {exc.response.status_code}") from None
        except httpx.RequestError:
            raise OIDCError("OIDC token revocation failed") from None

    # ── JWKS loading ───────────────────────────────────────────────────────

    async def _load_jwks(self, jwks_uri: str, force_refresh: bool = False) -> dict[str, Any]:
        """Load (and cache) JWKS from the provider.

        Set ``force_refresh=True`` to bypass the cache (e.g. on a kid miss).
        """
        now = time.time()
        cached = self._jwks_cache.get(jwks_uri)
        if not force_refresh and cached and now - cached[0] < self._jwks_ttl:
            return cached[1]

        try:
            resp = await self._http.get(jwks_uri)
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
        except httpx.HTTPStatusError as exc:
            raise OIDCError(f"JWKS fetch failed: HTTP {exc.response.status_code}") from exc
        except httpx.RequestError as exc:
            raise OIDCError(f"JWKS fetch failed: {exc}") from exc

        self._jwks_cache[jwks_uri] = (now, data)
        return data

    async def _resolve_signing_key(
        self,
        jwks_data: dict[str, Any],
        kid: str | None,
        algorithm: str,
        jwks_uri: str,
    ) -> Any | None:
        """Find the signing key matching ``kid`` in the JWKS.

        Returns the key object or ``None`` if no match is found. Catches
        invalid JWK entries (e.g. wrong key type for the algorithm) and
        logs a warning so a single bad entry does not crash validation.
        """
        for jwk_dict in jwks_data.get("keys", []):
            if kid and jwk_dict.get("kid") != kid:
                continue
            try:
                jwk = PyJWK(jwk_dict, algorithm=algorithm)
                return jwk.key
            except jwt.PyJWTError as exc:
                logger.warning("Skipping invalid JWK (kid=%s) from %s: %s", kid, jwks_uri, exc)
                if not kid:
                    # No kid in token — try next key
                    continue
                # kid was specified and this key is the one — fail fast
                raise OIDCValidationError(f"JWK for kid={kid} is invalid: {exc}") from exc
        return None

    # ── ID token validation ────────────────────────────────────────────────

    async def validate_id_token(
        self,
        metadata: OIDCMetadata,
        client_id: str,
        id_token: str,
        nonce: str | None = None,
    ) -> dict[str, Any]:
        """Validate the ID token and return its claims.

        Validates: signature (via JWKS), issuer, audience, expiration,
        issued-at, and nonce (if provided).
        """
        jwks_data = await self._load_jwks(metadata.jwks_uri)

        # Resolve the signing key from the JWKS using the token's kid header
        jwt_header = jwt.get_unverified_header(id_token)
        kid = jwt_header.get("kid")
        alg = jwt_header.get("alg", "RS256")

        allowed_algorithms = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"]
        if alg not in allowed_algorithms:
            raise OIDCValidationError(f"ID token uses unsupported algorithm '{alg}'")

        # Resolve signing key, refetching JWKS once on kid miss for key rotation
        signing_key = await self._resolve_signing_key(jwks_data, kid, alg, metadata.jwks_uri)
        if signing_key is None:
            jwks_data = await self._load_jwks(metadata.jwks_uri, force_refresh=True)
            signing_key = await self._resolve_signing_key(jwks_data, kid, alg, metadata.jwks_uri)
            if signing_key is None:
                raise OIDCValidationError(f"No matching JWK found for kid={kid} after JWKS refresh")

        try:
            claims = jwt.decode(
                id_token,
                key=signing_key,
                algorithms=allowed_algorithms,
                audience=client_id,
                issuer=metadata.issuer,
                options={
                    "verify_exp": True,
                    "verify_iat": True,
                    "require": ["exp", "iss", "sub", "aud"],
                },
            )
        except jwt.ExpiredSignatureError:
            raise OIDCValidationError("ID token has expired")
        except jwt.InvalidIssuerError:
            raise OIDCValidationError("ID token has an invalid issuer")
        except jwt.InvalidAudienceError:
            raise OIDCValidationError("ID token has an invalid audience")
        except jwt.PyJWTError as exc:
            raise OIDCValidationError(f"ID token validation failed: {exc}") from exc

        # Validate nonce if expected
        if nonce is not None:
            token_nonce = claims.get("nonce")
            if not token_nonce:
                raise OIDCValidationError("ID token is missing the nonce claim")
            if not _constant_time_compare(nonce, token_nonce):
                raise OIDCValidationError("ID token nonce does not match")

        return claims

    # ── UserInfo ────────────────────────────────────────────────────────────

    async def fetch_userinfo(self, metadata: OIDCMetadata, access_token: str, expected_sub: str) -> dict[str, Any]:
        """Fetch userinfo from the UserInfo endpoint.

        Validates that the ``sub`` claim matches ``expected_sub``
        (from the ID token) to prevent userinfo injection.
        """
        if not metadata.userinfo_endpoint:
            return {}

        headers = {"Authorization": f"Bearer {access_token}"}
        try:
            resp = await self._http.get(metadata.userinfo_endpoint, headers=headers)
            resp.raise_for_status()
            userinfo: dict[str, Any] = resp.json()
        except httpx.HTTPStatusError as exc:
            raise OIDCError(f"UserInfo fetch failed: HTTP {exc.response.status_code}") from exc
        except httpx.RequestError as exc:
            raise OIDCError(f"UserInfo fetch failed: {exc}") from exc

        if userinfo.get("sub") != expected_sub:
            raise OIDCUserInfoMismatch("UserInfo sub does not match ID token sub")

        return userinfo

    # ── Orchestrated callback ──────────────────────────────────────────────

    async def authenticate_callback(
        self,
        provider_id: str,
        metadata: OIDCMetadata,
        client_id: str,
        client_secret: str | None,
        code: str,
        redirect_uri: str,
        code_verifier: str | None = None,
        nonce: str | None = None,
        auth_method: str = "client_secret_post",
    ) -> OIDCAuthenticationResult:
        """Orchestrate the full OIDC callback: token exchange, ID token validation, userinfo.

        Returns a normalized identity and backend-only token material. Callers
        must keep the token fields server-side and encrypt them before
        persistence; never serialize this result into a response, cookie, or
        Agent run configuration.
        """
        token_response = await self.exchange_code(
            metadata=metadata,
            client_id=client_id,
            client_secret=client_secret,
            code=code,
            redirect_uri=redirect_uri,
            code_verifier=code_verifier,
            auth_method=auth_method,
        )

        return await self._result_from_token_response(
            provider_id=provider_id,
            metadata=metadata,
            client_id=client_id,
            token_response=token_response,
            nonce=nonce,
        )

    async def authenticate_password(
        self,
        provider_id: str,
        metadata: OIDCMetadata,
        client_id: str,
        client_secret: str | None,
        username: str,
        password: str,
        scope: str,
        auth_method: str = "client_secret_post",
    ) -> OIDCAuthenticationResult:
        """Orchestrate the ROPC password grant: token request, ID token validation, userinfo.

        Same result contract as ``authenticate_callback`` — verified identity
        plus backend-only token material for the encrypted vault. There is no
        nonce in this flow (no front-channel authorization request), so the ID
        token nonce check is skipped.
        """
        token_response = await self.request_password_token(
            metadata=metadata,
            client_id=client_id,
            client_secret=client_secret,
            username=username,
            password=password,
            scope=scope,
            auth_method=auth_method,
        )

        return await self._result_from_token_response(
            provider_id=provider_id,
            metadata=metadata,
            client_id=client_id,
            token_response=token_response,
        )

    async def _result_from_token_response(
        self,
        *,
        provider_id: str,
        metadata: OIDCMetadata,
        client_id: str,
        token_response: dict[str, Any],
        nonce: str | None = None,
    ) -> OIDCAuthenticationResult:
        """Validate tokens and build the normalized authentication result.

        Shared by the authorization-code callback and the ROPC password grant;
        keeps identity/tenant boundaries anchored to the validated ID Token.
        The nonce check applies only to the front-channel code flow.
        """
        id_token = token_response.get("id_token")
        if not id_token:
            raise OIDCError("Token response is missing id_token")

        access_token = token_response.get("access_token", "")

        claims = await self.validate_id_token(
            metadata=metadata,
            client_id=client_id,
            id_token=id_token,
            nonce=nonce,
        )

        # Fetch userinfo for email/name if not present in ID token
        userinfo: dict[str, Any] = {}
        if metadata.userinfo_endpoint and access_token:
            try:
                userinfo = await self.fetch_userinfo(
                    metadata=metadata,
                    access_token=access_token,
                    expected_sub=claims["sub"],
                )
            except OIDCError as exc:
                logger.warning("OIDC userinfo fetch failed (continuing with ID token): %s", exc)

        # Merge profile claims from UserInfo, while keeping identity and tenant
        # boundaries from the already validated ID Token. The IAM authorization
        # adapter uses tenant_id to choose the authorization domain, so a
        # UserInfo-only tenant value must never become that trusted context.
        merged = {**claims, **userinfo}
        merged["sub"] = claims["sub"]
        if "tenant_id" in claims:
            merged["tenant_id"] = claims["tenant_id"]
        else:
            merged.pop("tenant_id", None)

        email = merged.get("email") or ""
        email_verified = merged.get("email_verified") is True

        access_expires_in = token_response.get("expires_in")
        refresh_expires_in = token_response.get("refresh_expires_in")
        return OIDCAuthenticationResult(
            identity=OIDCIdentity(
                provider=provider_id,
                subject=claims["sub"],
                email=email,
                email_verified=email_verified,
                name=merged.get("name"),
                claims=merged,
            ),
            access_token=access_token if isinstance(access_token, str) and access_token else None,
            refresh_token=(token_response.get("refresh_token") if isinstance(token_response.get("refresh_token"), str) and token_response.get("refresh_token") else None),
            access_token_expires_in=(access_expires_in if type(access_expires_in) is int and access_expires_in >= 0 else None),
            refresh_token_expires_in=(refresh_expires_in if type(refresh_expires_in) is int and refresh_expires_in >= 0 else None),
        )


def _constant_time_compare(a: str, b: str) -> bool:
    """Constant-time string comparison."""
    return secrets.compare_digest(a, b)
