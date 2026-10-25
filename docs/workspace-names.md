# Workspace names and sign-in

`tenant_id` remains the internal key for queries, sessions, membership admission
and routes. `h1_tenants.display_name` and `h1_tenants.slug` are nullable text
columns. The display label is the nonempty display name, otherwise the tenant ID.
Slugs are internal labels; there are no slug URLs.

Operator provisioning stores the existing required `name` as both the namespace
name and tenant display name. Names follow the existing `label()` validation:
nonblank, at most 512 characters, with no ASCII control characters U+0000–U+001F.
An optional `slug` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` and be at most 64
characters. Invalid supplied slugs return `METADATA_INVALID` (400).

Without an explicit slug, provisioning lowercases the display name, replaces
runs of non-ASCII-alphanumeric characters with a hyphen, trims surrounding
hyphens, truncates to 64 characters and trims any trailing hyphen. An empty
result remains NULL. Slugs are unique across tenants; multiple NULL slugs are
allowed. A conflict returns `TENANT_SLUG_CONFLICT` (409) without creating partial
tenant, namespace or membership rows. Reusing an operation key with changed
input, including a changed slug, returns `OPERATION_ID_REUSED`.

The owner migration adds missing columns and a unique index idempotently in
SQLite and PostgreSQL. Existing tenants retain NULL names and slugs: names are
set when an operator provisions or explicitly backfills/renames a workspace,
not inferred from namespace names during migration. This change adds no rename
endpoint. Any operator backfill must use the same validation and uniqueness
rules. Registered serverless backups from before naming remain eligible for
migration and restore; new login challenges are invalidated on restore.

Invitations show `Workspace: <display_name>` when named, otherwise
`Tenant: <tenant_id>`. Display names are escaped in HTML email. The header uses
the same display-name fallback. `GET /api/session` includes `workspaceName` and
`workspaceSlug` (a string or NULL); the browser also supports older servers
without those fields.

Sign-in asks for email, password and the existing authenticator code. It does
not ask for a workspace ID. After the unchanged credential verification:

- No active membership in an active tenant returns `AUTHENTICATION_FAILED` (401).
- One admissible workspace returns the usual session immediately.
- Multiple workspaces return a selection challenge with the authenticated email,
  each workspace's tenant ID, display label and slug, an opaque `selectionToken`,
  and `selectionExpiresAt`. No session is issued yet.

Only the token digest, subject, expiry and consumed flag are stored in
`h2_login_selections`. The challenge lasts five minutes. TOTP consumption and
challenge creation share a transaction. The browser shows “Choose your
workspace” with real buttons and optional secondary slug labels.

`POST /api/auth/login/select` takes `{ selectionToken, tenantId }`, rate-limits
attempts, rechecks identity status and membership admission, and consumes the
challenge and issues a session atomically. Unknown, invalid, expired, replayed
or inadmissible selections return `AUTHENTICATION_FAILED` (401). Selection uses
the same POST-only, no Authorization/Cookie boundary as login. A failed selection
returns the browser to sign-in with a sanitized error.

Explicit-tenant login remains available for existing API clients. Password,
TOTP, enrollment, tenant isolation and signed-in switching semantics are unchanged.
