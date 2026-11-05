# H2: verified tenant sessions and provisioning (#22)

H2 adds a separate hosted HTTP composition over H1 metadata. It uses built-in
email/password plus mandatory TOTP through `SecurityOptions.authenticate`.
`GET /api/session` reports the current registered user, namespace and tenant.
The verifier seam can route multiple credential adapters; no OIDC adapter ships.
There is no automatic signup or membership creation during login.

## Configuration and startup

Run the API CLI with `OPENSIGHT_MODE=hosted`. The default remains the local
fixture server; supplying hosted authentication configuration without selecting
hosted mode refuses startup. Hosted startup requires durable, reachable H1/H2
metadata, a verifier and the following environment configuration:

| Variable | Value |
| --- | --- |
| `OPENSIGHT_METADATA_DATABASE` | Durable SQLite file for the CLI; never `:memory:` |
| `OPENSIGHT_PUBLIC_ORIGIN` | Exact HTTPS origin, without a path or trailing slash |
| `OPENSIGHT_AUTH_ISSUER`, `OPENSIGHT_AUTH_AUDIENCE` | Explicit nonempty identifiers |
| `OPENSIGHT_AUTH_KEY_ID` | Unique identifier for the active signing key |
| `OPENSIGHT_AUTH_SIGNING_KEY` | Random 32-byte key, canonical base64 |
| `OPENSIGHT_AUTH_ENCRYPTION_KEY` | Separate random 32-byte key, canonical base64 |
| `OPENSIGHT_OPERATOR_KEY` | Third random 32-byte key, canonical base64 |
| `OPENSIGHT_SESSION_SECONDS` | Explicit integer, 900–36000; no default |
| `OPENSIGHT_INVITATION_SECONDS` | Explicit integer, 1–604800; no default |

Issue #63 applies the settled HQ-7 15–600 minute range to hosted sessions.
Existing environment-only SMTP configuration delivers invitations;
provisioning refuses when SMTP is unconfigured. Tests inject the stub transport.
Store configuration and private runtime files outside the repository or under
ignored `.opensight/`. The CLI creates its database with private permissions.

Terminate TLS at a trusted reverse proxy, preserve the configured public Host,
and restrict access to the backend listener. Forwarded host headers are rejected;
they never select identity or tenant. Browser Origin, when present, must exactly
match the configured origin. Operator requests must have no browser Origin.

Library users initialize H1 metadata and call `createBuiltinHostedServer` with
durable membership and tenant databases. `createHostedApiServer` requires an
explicit `security.authenticate` verifier. For PostgreSQL, use separate privileged
membership/operator and restricted tenant pools as in H1. Grant the tenant role
access only to H1 tenant tables; **never grant it access to `h2_*`**. H2 credentials,
invitations, rate limits and session records belong to the privileged store.

## Operator and invitation flow

Operator requests use `Authorization: Operator <base64url encoding of the operator
key bytes>`. This deployment operator has no tenant data access. Tenant sessions,
including administrators, cannot use the operator plane or create namespaces.

- `POST /api/host/tenants`: `{name, displayName, slug?, administrator:{email,name}}` plus an
  `Idempotency-Key`. Reserves opaque tenant/namespace/user IDs, membership,
  invitation and operation atomically. Sends the invitation, verifies the mapping,
  and activates the empty tenant. Returns safe operation progress and current
  state with 201; credentials are delivered only in the invitation email.
  `displayName` is a required nonblank workspace label (up to 512 characters,
  no control characters); `name` remains the namespace name. Optional `slug`
  must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, up to 64 characters. Omission derives
  it from the display name; a name with no ASCII letters/digits has a null slug.
  Slug collisions return `TENANT_SLUG_CONFLICT` (409). A rejected creation has
  no tenant and does not reserve the form's idempotency key.
- `GET /api/host/tenants`: lists display name, slug, lifecycle state, billing
  tier (absent/null is Free), nonremoved member count and creation time from
  the retained provisioning audit entry (unknown for unaudited legacy rows).
  Deleted tenants remain listed, with zero members.
- `GET /api/host/operations/{operationId}` and `GET /api/host/tenants/{tenantId}`:
  inspect operation progress and lifecycle/version. Tenant detail also includes
  display name, slug and the original provisioning operation ID.
- `POST /api/host/tenants/{tenantId}/invitations`: `{email,name,role}` plus an
  idempotency key. Creates another preprovisioned membership before login.
- `POST /api/host/tenants/{tenantId}/suspend` or `/resume`, and
  `DELETE /api/host/tenants/{tenantId}`: `{expectedVersion}` plus an idempotency
  key. Deletion enters `deleting` and immediately denies admission. Artifact
  cleanup, retention and final tombstoning remain the H1 operator lifecycle/H8;
  H2 does not claim to have purged tenant artifacts.
- `DELETE /api/host/tenants/{tenantId}/users/{userId}` with `{}` removes membership
  admission and revokes sessions. It retains the user resource for existing
  owner/reference integrity. Repeating removal is harmless.

Idempotency keys are scoped to the deployment operator and payload checksum.
Changed payloads after a committed reservation return `OPERATION_ID_REUSED`. Retrying onboarding resumes after
delivery failure without creating another tenant. Delivery is at least once:
a crash after SMTP acceptance can resend the same invitation, never a new grant.
Expired invitations fail closed; renewal/recovery UI is outside this slice.

The invitation email leads with a browser link to
`<OPENSIGHT_PUBLIC_ORIGIN>/#invite=<token>` and names the workspace. New invitees
set and confirm a password, scan the authenticator QR code (or copy the base32
setup key), and confirm a live TOTP code. The page shows the invited account and
issuer. Successful setup clears the invitation hash and continues into sign-in
with the email and password held only in memory. Wait for a fresh authenticator
code before signing in; the setup code has already been consumed. A sole active
workspace opens directly; multiple workspaces use the named picker (D-83).

Already-enrolled invitees sign in with their existing credentials, then accept
the pending invitation through `POST /api/invitations/accept` with `{token}` and
their verified session. Acceptance is bound to that session's identity, activates
only the invited membership, and does not reset credentials or switch workspaces.
Used, expired and revoked invitations fail closed with named errors. No session
or credential is issued by acceptance.

The API workflow remains available for operators and automation:

1. `POST /api/auth/enroll` with `{invitationToken,password}` returns the TOTP
   base32 secret and `otpauth` URI for the enrolling identity. Passwords require
   15 characters and at most 1024 UTF-8 bytes. A retry must prove the same password;
   an active identity's credentials cannot be reset by another tenant invitation.
2. `POST /api/auth/accept` with `{invitationToken,password,code}` confirms MFA
   and activates the membership. Replays acknowledge completion without issuing
   sessions. Existing identities use their existing password and authenticator.
3. Wait for the next authenticator code, then `POST /api/auth/login` with
   `{email,password,code,tenantId}`. The result is `{token,expiresAt,tenantId}`;
   `expiresAt` is Unix milliseconds. Email is normalized to lowercase.

See [browser enrollment (#152)](issue-152-browser-enrollment.md) and
[the sign-in screen](issue-63-signin-screen.md) for browser behavior and errors.

## Sessions, storage and revocation

Tenant requests use `Authorization: Bearer <token>`. H2 sets no cookies and adds
no browser persistence. Clients must clear their old token and tenant caches on
switch/logout and keep tokens out of URLs. `POST /api/auth/switch` with
`{tenantId}` verifies the target membership and atomically replaces the current
session; a failed switch preserves it. `POST /api/auth/logout` with `{}` revokes
the current session. Switching preserves the original expiry, so repeated switches
cannot extend login lifetime. No implicit renewal or anonymous embedding is provided.

Passwords use Node's built-in scrypt (`N=131072`, `r=8`, `p=1`), independent
128-bit salts and a 256-bit result. This memory-hard choice adds no dependencies
and works throughout the repository's declared Node 24 support range.
At most two password derivations run concurrently per process. TOTP uses random
160-bit secrets, AES-256-GCM encryption bound to the immutable subject, six digits,
30-second steps and a ±1-step window. The last accepted step is updated atomically
to prevent concurrent replay. Hash/signature/code comparisons use constant-time
comparison. Invitation bearer tokens are hashed and their retry-delivery copy is
encrypted with invitation-specific associated data.

Durable rolling-start 15-minute buckets admit at most 10 attempts per email or
invitation, 50 per socket peer, and 200 globally. They survive process restarts;
forwarded client IPs are not trusted. Deployments behind one proxy share its peer
bucket. These conservative pilot limits trade availability for bounded guessing.

Sessions have random opaque IDs, HMAC signatures bound to the issuer/audience/
origin and key ID, and authoritative tenant/namespace/subject/user records.
Every request checks expiry, current key, active membership and tenant state, plus
membership and authorization/policy revisions. There is no auth
cache. Suspension followed by resume does not resurrect old sessions. Membership
removal, authorization/policy revision changes and key rotation deny subsequent
operations. Configuration-only changes preserve H2 sessions (#170). The stored
issue-time configuration revision remains for schema compatibility; independent
content-freshness checks still reject work captured before a configuration change.

To rotate signing keys, supply a new key ID and signing key through the environment
and run `node packages/api/dist/cli.js rotate-auth-key` in hosted mode. Restart
API processes with that configuration. The trusted command atomically retires
previous keys; old processes immediately reject their sessions and cannot issue
new ones. Retired IDs cannot be reactivated. It does not rotate the TOTP encryption
key; changing that key without reencrypting records makes credentials unavailable.

Hosted H2 exposes session reporting and scoped namespace/user/group reads.
Legacy fixtures, sources, prep, queries, embedding and automation have no hosted
fallback: unauthenticated requests are denied, and authenticated unsupported
operations return `HOSTED_CAPABILITY_UNAVAILABLE`. H3 and H6 provide their scoped
data and embed paths; [H7](tenant-automation.md) now provides owned recurring jobs,
durable histories/outbox and the operator transfer-or-stop removal choice. No
ownerless scheduler runs in the hosted composition. The static demo remains a
local artifact, not a deployed server.


## Operator provisioning pages (#192)

In the hosted app, open `#operator-tenants` to list/filter workspaces or create
one. `#operator-tenant/<tenantId>` shows its overview, billing, inline usage,
people and lifecycle controls. All operator pages link to Tenants, Tenant users
and Ideas. These pages are absent from the offline demo.

Each page requires the operator credential. It stays in component memory, clears
on Disconnect/navigation, and is sent with `credentials: 'omit'`; no cookie or
browser storage carries it. Trusted-Origin requests are allowed only for the
existing ideas/users routes and the precise provisioning shapes and methods:
list/create, detail/delete, invitations, suspend/resume, billing read/payment-link/
resolve, and GET `/api/host/usage/<YYYY-MM>/tenants/<tenantId>`. Other host routes
(including audit, operations, health and usage rollups) still reject Origin.
Tenant sessions cannot use any of these operator routes.

Creating always starts on Free. Selecting a paid plan generates a payment link
after creation; payment and the billing webhook change the tier. A billing 404
shows a not-configured message and leaves the successful tenant on Free. Missing
mail prevents creation with `SMTP_NOT_CONFIGURED`. Each create form session
uses one idempotency key and disables submission while working. Invitations are
emailed by the server; these operator pages never show invitation tokens.

Usage comes from the existing per-tenant usage route. Its additive `overview`
contains current daily UTC API/query counts and quotas, live logical storage,
and monthly NLQ usage/quota. Quotas come from the billing override or configured
entitlements, never hardcoded plan numbers. Stored monthly `records` keep their
existing rollup semantics. The overview is null for past months. Missing usage
configuration is shown explicitly, rather than as zero use.

Suspend, Resume and Delete refetch the version immediately before submitting.
A conflict refreshes the page data; `RESTORE_REVIEW_REQUIRED` remains explicit.
Past-due billing resolution requires confirmation. Delete requires typing the
slug (tenant ID for a legacy/null slug), revokes access and enters `deleting`.
Deleting and deleted tenants are read-only; a completed deletion shows the
retained tombstone. Full erasure is separate offline maintenance, audit entries
are retained, and serverless object-store erasure remains unsupported and fails
closed. There is no erasure, rename, impersonation or tenant-facing action here.
