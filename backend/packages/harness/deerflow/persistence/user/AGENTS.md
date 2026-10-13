# User persistence

`user_preferences` stores independent `(user_id, key)` rows in the shared SQL
database. PATCH upserts only supplied keys in one transaction; `null` resets a
field, disjoint edits commute, and same-field writes are last-commit-wins.

The Gateway's `GET/PATCH /api/v1/auth/preferences` allows only notification
enablement, the default model, conversation mode, and reasoning effort. It
requires a browser session plus `X-Expected-User-Id` matching that session (a
stale-tab guard, never an authorization source); PAT, internal, and auth-disabled
callers are rejected. Never persist arbitrary agent context or credentials
through this API. See `backend/docs/API.md` for the HTTP contract.

`iam_oidc_token_vault` is Gateway-owned server-side credential storage for
explicit IAM OIDC Providers. Each login has one `(user_id, session_id)` row so
refresh tokens from parallel sessions stay isolated. Persist ciphertext only;
AES-GCM AAD binds issuer, subject, tenant, session ID, and token purpose. Generic
row serialization and repr must continue to omit token envelopes. Schema changes
belong in a migration after `0025_user_active`; never silently create or backfill
vault rows from user profile data.
