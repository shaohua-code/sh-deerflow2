# SSO / OIDC Authentication

DeerFlow supports single sign-on (SSO) via any OpenID Connect (OIDC) 2.0 compliant provider. This includes Keycloak, Google Workspace, Azure AD, Okta, and many others.

## Architecture

The OIDC flow uses the **Authorization Code flow** with PKCE (S256) and nonce validation for defense in depth:

```
Browser                      Gateway                    OIDC Provider
  │                             │                            │
  │  1. Click "Login with X"    │                            │
  │ ─────────────────────────▶  │                            │
  │                             │  2. Build auth URL         │
  │                             │     + state (signed cookie)│
  │                             │     + PKCE code_challenge  │
  │                             │     + nonce                │
  │                             │                            │
  │  3. Redirect to provider    │                            │
  │ ◀────────────────────────── │                            │
  │                             │                            │
  │  ──────────────────────────────────────────────────────▶ │
  │                             │   4. User authenticates    │
  │  ◀────────────────────────────────────────────────────── │
  │        5. Auth code + state │                            │
  │                             │                            │
  │  6. Callback → Gateway      │                            │
  │ ─────────────────────────▶  │                            │
  │                             │  7. Validate state cookie  │
  │                             │  8. Exchange code + PKCE   │
  │                             │     ─────────────────────▶ │
  │                             │     ◀──── tokens ──────────│
  │                             │  9. Validate ID token      │
  │                             │     (JWKS, iss, aud, nonce)│
  │                             │ 10. Fetch userinfo         │
  │                             │     ─────────────────────▶ │
  │                             │     ◀──── user claims ─────│
  │                             │ 11. Provision/link user    │
  │                             │ 12. Set session + CSRF     │
  │                             │     cookies                │
  │ ◀─ redirect to /auth/callback                            │
  │                             │                            │
  │ 13. Frontend detects auth   │                            │
  │     redirects to workspace  │                            │
```

**Key design decisions:**

- **State via signed cookie** — No server-side session store or Redis needed. The OIDC state (provider, nonce, code_verifier, next path) is signed with the JWT secret and stored in an HttpOnly cookie.
- **PKCE + nonce enabled by default** — Even though confidential clients could use `client_secret`, PKCE provides an extra layer of security.
- **No email auto-linking** — a pre-existing local (email/password) account is never auto-linked to an SSO identity. If the IdP-reported email collides with an existing local account, the SSO login is blocked with a 409 so an SSO login can never seize a password account.
- **Existing DeerFlow JWT** — After successful OIDC authentication, DeerFlow creates its own JWT session cookie. The OIDC provider's tokens are never exposed to the browser. An explicitly enabled IAM vault uses the local JWT `sid` only to select that browser session's server-side encrypted token row.

## Configuration

### Step 1: Enable OIDC in `config.yaml`

```yaml
auth:
  oidc:
    enabled: true
    frontend_base_url: http://localhost:3000
    providers:
      keycloak:
        display_name: Keycloak
        issuer: http://localhost:8080/realms/deerflow
        client_id: deerflow
        client_secret: $KEYCLOAK_CLIENT_SECRET
        redirect_uri: http://localhost:8001/api/v1/auth/callback/keycloak
        scopes:
          - openid
          - email
          - profile
        # For the IAM integration only, opt in to the encrypted token vault:
        # iam_token_vault_enabled: true
        # scopes:
        #   - openid
        #   - email
        #   - profile
        #   - offline_access
```

`iam_token_vault_enabled` defaults to `false` and should remain off for ordinary
social OIDC providers. When enabled for the IAM Provider, the Gateway requires
the `offline_access` scope and `DEERFLOW_IAM_TOKEN_ENCRYPTION_KEY` in the API
environment. Generate a random 32-byte key and encode it with standard Base64;
keep it in the Gateway's backend Secret Manager or local `.env`, never in
`config.yaml`, browser variables, or source control. The Gateway encrypts token
values with AES-256-GCM and stores one row per `(user_id, local_session_id)` in
`iam_oidc_token_vault`; migration `0026_iam_oidc_token_vault` adds that table.
Local logout deletes that session's row, which prevents this Gateway from using
the stored refresh token again. OIDC discovery now retains the optional
`revocation_endpoint`, and `OIDCService.revoke_token()` implements the RFC 7009
HTTPS form request with client-secret-post/basic/public-client auth and
credential-redacted errors. The Gateway logout route does not call it: sending
stored bearer credentials to the external issuer remains disabled until the
operator explicitly approves that token egress. For now, logout is local-only;
an upstream session may remain active until its own expiry or IAM-side revocation.
`OIDCService.refresh_tokens()` and `IamTokenVaultRepository.load_or_refresh_for_identity()`
are used by Gateway authorization to revalidate the matching vault session and
rotate near-expiry credentials. Route, model-catalog, sandbox, Agent model/tool,
and request-time memory data-scope checks use the run-scoped capability. The
passive memory worker carries no capability: before every storage commit it
submits a fresh check to the Gateway loop, reloads the active local user and
matching vault session, then rechecks exact owner/self read+write scopes. A
revoked or unavailable session/grant, missing loop, or timeout skips the write.
Upstream IAM token revocation is not wired into logout yet. Do not call the
revocation method from logout until the deployment explicitly authorizes sending
its server-held access and refresh tokens to the configured issuer.
Changing the key without re-encrypting
existing rows makes those rows undecryptable; plan a controlled re-encryption or
require fresh logins.

### Step 2: Set the client secret as an environment variable

```bash
export KEYCLOAK_CLIENT_SECRET="your-client-secret"
```

Or create a `.env` file in the `backend/` directory:

```
KEYCLOAK_CLIENT_SECRET=your-client-secret
```

### Step 3: Restart the backend

```bash
cd backend && make dev
```

## Provider Configuration

### Per-Provider Options

```yaml
providers:
  <provider-id>:
    display_name: "Display Name"    # Shown on the SSO button
    issuer: "https://..."           # OIDC issuer URL (must match the provider's .well-known/openid-configuration)
    client_id: "..."                # OAuth2 client ID
    client_secret: $SECRET          # OAuth2 client secret (supports $ENV_VAR)
    redirect_uri: "..."             # Optional: explicit callback URL
    scopes:                         # Default: ["openid", "email", "profile"]
      - openid
      - email
    token_endpoint_auth_method: "client_secret_post"  # client_secret_post, client_secret_basic, or none

    # User provisioning
    auto_create_users: true         # Auto-create DeerFlow account on first SSO login (default: true)
    require_verified_email: true    # Reject logins without verified email (default: true)
    allowed_email_domains: []       # Restrict to specific domains (default: no restriction)
    admin_emails: []                # Deprecated compatibility field; ignored, never grants admin

    # For IAM only: opt in to encrypted access/refresh token storage.
    # Requires offline_access and DEERFLOW_IAM_TOKEN_ENCRYPTION_KEY in Gateway env.
    # iam_token_vault_enabled: true

    # Security features (both enabled by default)
    pkce_enabled: true
    nonce_enabled: true

    # Endpoint overrides (optional)
    # Use if the provider has non-standard endpoints.
    # authorization_endpoint: "https://..."
    # token_endpoint: "https://..."
    # userinfo_endpoint: "https://..."
    # jwks_uri: "https://..."
```

### Endpoint Overrides

Some providers don't return all endpoints from their `.well-known/openid-configuration`. You can override specific endpoints:

```yaml
providers:
  my-provider:
    display_name: "My Provider"
    issuer: "https://provider.example.com"
    client_id: "..."
    client_secret: $SECRET
    authorization_endpoint: "https://provider.example.com/oauth2/authorize"
    token_endpoint: "https://provider.example.com/oauth2/token"
    userinfo_endpoint: "https://provider.example.com/oauth2/userinfo"
    jwks_uri: "https://provider.example.com/oauth2/jwks"
```

## Local Keycloak Example

This section walks through setting up a local Keycloak instance with Podman or Docker for development.

### 1. Start Keycloak

```bash
# Using Podman
podman run -d \
  --name keycloak \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.1 \
  start-dev

# Using Docker
docker run -d \
  --name keycloak \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.1 \
  start-dev
```

### 2. Create a Realm and Client

1. Open the Keycloak admin console: http://localhost:8080
2. Log in with `admin` / `admin`
3. Create a new realm called `deerflow`
4. In the `deerflow` realm, go to **Clients** → **Create client**
5. Configure:
   - **Client ID**: `deerflow`
   - **Client authentication**: On (makes it a confidential client)
   - **Standard flow**: Enabled
   - **Valid redirect URIs**: `http://localhost:8001/api/v1/auth/callback/keycloak`
   - **Valid post logout redirect URIs**: `http://localhost:3000/*`
   - **Web origins**: `http://localhost:8001` (or `+` to allow all redirect URI origins)
6. After creating the client, go to the **Credentials** tab
7. Copy the **Client secret** — this is your `KEYCLOAK_CLIENT_SECRET`

### 3. Create a Test User

1. In the `deerflow` realm, go to **Users** → **Add user**
2. Set **Username**: `testuser`
3. Set **Email**: `testuser@example.com`
4. Set **Email verified**: On
5. Go to the **Credentials** tab
6. Set a password (e.g. `testpass123`)
7. Set **Temporary**: Off

### 4. Configure DeerFlow

Add to `config.yaml`:

```yaml
auth:
  oidc:
    enabled: true
    frontend_base_url: http://localhost:3000
    providers:
      keycloak:
        display_name: Keycloak
        issuer: http://localhost:8080/realms/deerflow
        client_id: deerflow
        client_secret: $KEYCLOAK_CLIENT_SECRET
        redirect_uri: http://localhost:8001/api/v1/auth/callback/keycloak
        scopes:
          - openid
          - email
          - profile
```

Set the secret:

```bash
export KEYCLOAK_CLIENT_SECRET="the-secret-from-step-2"
```

### 5. Restart and Test

```bash
cd backend && make dev
```

1. Open http://localhost:3000
2. On the login page, click **Login with Keycloak**
3. You'll be redirected to Keycloak's login page
4. Log in with `testuser` / `testpass123`
5. After successful authentication, you'll be redirected back to the DeerFlow workspace

## Account Settings for SSO Users

When a user logs in via SSO, the account settings page detects this (via the `oauth_provider` field returned by `/api/v1/auth/me`) and:

- Displays the SSO provider name (e.g. "Keycloak") in the profile section
- Replaces the password change form with an informational message
- Password changes must be done through the SSO provider, not DeerFlow

The backend also rejects password change requests for OAuth users:

```json
{
  "code": "invalid_credentials",
  "message": "OAuth users cannot change password"
}
```

## IAM Password Direct Login (ROPC)

When `auth.oidc.providers.iam.password_grant_login` is `true`, the login page posts the
credentials to `POST /api/v1/auth/login/iam` (OAuth2 form: `username`, `password`,
`remember_me`). The Gateway forwards them to the provider token endpoint with
`grant_type=password` and then issues the same local session as the SSO callback
(provisioning/linking, audit, encrypted token vault when `iam_token_vault_enabled`).
There is no local-account fallback: IAM is the only credential source.

- The provider must be a trusted client that accepts `client_secret_basic`. Under Basic
  auth the request body carries neither `client_id` nor `client_secret`; strict providers
  (the central IAM token endpoint included) reject the request as `invalid_request`
  otherwise. The password grant and the authorization-code exchange follow this rule.
- **Known gap:** `OIDCService.refresh_tokens` still sends `client_id` in the body under
  Basic auth, so a refresh against the central IAM is rejected. Until that is fixed, menu
  and button control degrades to `controlled=false` once the vault access token nears
  expiry (IAM default lifetime: 30 minutes) and only recovers after a new login.
- Error mapping: provider `invalid_grant` → 401 `invalid_credentials` (counted by the
  local login throttle); provider 429 → 429; any other provider rejection (client or
  configuration) → 502 and not counted as a failed login.

## IAM Menu / Button Control

`GET /api/v1/auth/iam/resources` (authenticated) calls IAM
`GET /api/v1/authorization/my-resources` with the access token held in the token vault and
returns only the granted codes: `{controlled, menus: string[], buttons: string[]}`.
Non-IAM sessions, a missing vault session, or an unreachable IAM return
`controlled=false`, and the frontend then shows every menu and button. Menu and button
visibility is presentation only; it never replaces API authorization.

## Public API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/auth/providers` | Returns list of enabled SSO providers (safe metadata only) |
| `GET /api/v1/auth/oauth/{provider}` | Initiates SSO login, redirects to the OIDC provider |
| `GET /api/v1/auth/callback/{provider}` | OIDC callback — exchanges code, creates session, redirects to frontend |
| `POST /api/v1/auth/login/iam` | Password direct login against the `iam` provider (ROPC); requires `password_grant_login: true` |
| `GET /api/v1/auth/iam/resources` | Authenticated — menus and buttons granted through the IAM resource tree |

## Frontend Callback Flow

The frontend handles the post-SSO flow at `/auth/callback`:

1. After the backend processes the OIDC callback and sets cookies, it redirects to `{frontend_base_url}/auth/callback?next=...`
2. The callback page calls `GET /api/v1/auth/me`
3. On success: redirects to the workspace (or the original `next` path)
4. On failure: redirects to `/login?error=sso_failed`

## Security Notes

- **State cookies** are HttpOnly, SameSite=Lax, Max-Age=300 seconds, and signed with the JWT secret
- **PKCE** prevents authorization code interception attacks
- **Nonce** prevents ID token replay attacks
- **UserInfo sub check** ensures the UserInfo response matches the ID token subject
- **IAM token vault** is opt-in, AES-GCM encrypted, session-scoped and server-only. When the configured AuthorizationProvider requires IAM identity, Gateway resolves a signed local `sid` to the active account's encrypted session and provides a redacted in-memory credential Mapping for route/model-catalog/sandbox-sync and Agent model/tool authorization. Agent memory tools and passive memory queue admission enforce owner/self data scopes before touching the manager. Before persistence the async worker reloads the active owner and matching vault session on the Gateway loop, then rechecks memory read+write scope; credentials never enter the queue, and missing/revoked authorization fails closed. The vault does not grant permissions by itself and does not revoke the upstream IAM session.
- **Reject alg=none** — ID tokens with algorithm "none" are always rejected
- **No email auto-linking** — SSO accounts are always separate from email/password accounts. An email collision with an existing local account blocks the SSO login (409) rather than merging the two.
- **Verified email requirement** — SSO users must have verified emails by default
