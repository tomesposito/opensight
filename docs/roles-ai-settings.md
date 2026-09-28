# Issue #7: roles and AI settings

The authoritative implementation brief is Tom's Issue #7 decisions supplied for
this build. SOLUTION_DESIGN.md is unchanged.

The registry accepts `administrator`, `author`, `author_ai`, `reader`, and
`reader_ai`. Loading trusted legacy state maps `admin` to `administrator` and
retains `reader`; subsequent writes persist canonical roles. HTTP mutations
reject `admin`. Administrators manage system settings and namespace users.
Authors can use the builder; readers access published dashboard definitions and
visual queries only. AI capability belongs to administrator, author_ai and
reader_ai. Role checks always re-read the registered user, so demotion takes
effect on the next request. Resource grants never elevate a namespace role.

`GET /api/session` returns the authenticated user's registered role. The injected
server credential verifier supplies only identity, never client role claims.
Hosted UI gates use this session; an unresolved session has no capabilities.
The offline public sample preview has a fixed author_ai persona and grants no
hosted access. It is not authentication. Hosted authentication integration stays
with the existing `SecurityOptions.authenticate` deployment boundary.

Analysis access and unrestricted dataset queries require `SECURITY_BUILD_REQUIRED`;
admin routes require `SECURITY_ADMIN_REQUIRED`. Dashboard access still intersects
namespace, folder and asset grants and dataset row/column policies.

The entire O bar (including deterministic mode) is AI-gated on builder and
published-dashboard surfaces. `POST /api/o/query` takes `{ query, dashboardId? }`:
AI authors can query their namespace's sales binding; reader_ai must supply an
accessible published dashboard bound to that dataset. Missing AI capability
returns `SECURITY_AI_REQUIRED`; omission of dashboard scope by a reader returns
`SECURITY_BUILD_REQUIRED`. Queries still enforce RLS/CLS. Readers never see ADD TO
ANALYSIS. No caller identity, role, or policy is accepted in the query body.

## Provider configuration API

All `/api/admin/ai` routes require an administrator in the authenticated namespace:

- `GET /api/admin/ai`: provider, model, endpoint, `hasKey`, configuration state,
  storage mode and whether key saving is available. No secret or secret fragment.
- `POST /api/admin/ai`: `{ provider, model, baseUrl? }`.
- `POST /api/admin/ai/key`: `{ key }`; write-only replacement.
- `POST /api/admin/ai/test`: `{}`; minimal provider completion, returning `{ ok: true }`.

Provider IDs: `openai` (Responses), `anthropic` (Messages), `openai-compatible`
(Chat Completions), `bedrock`. The Bedrock adapter always returns
`AI_BEDROCK_APPROVAL_REQUIRED`, including tests; no runtime approval flag exists.
Compatible URLs must be HTTPS, non-AWS, and in the trusted server allowlist.

Environment configuration (server only; never use Vite variables for secrets):
`OPENSIGHT_AI_STORE` is an optional private file path, `OPENSIGHT_AI_ENCRYPTION_KEY`
is a base64-encoded random 32-byte encryption key supplied separately by the
server environment/secret manager. Saved API keys use AES-256-GCM, authenticated
with namespace/provider/endpoint, in the atomic 0600 store. Without a store path,
settings are ephemeral. Without an encryption key, saving a key fails with
`AI_SECURE_STORE_REQUIRED`; environment bootstrap keys still work. Keep the
private store outside fixture and source directories. Do not commit it.

Optional default-namespace bootstrap variables: `OPENSIGHT_AI_PROVIDER`,
`OPENSIGHT_AI_MODEL`, `OPENSIGHT_AI_API_KEY`, `OPENSIGHT_AI_COMPATIBLE_URL`.
The compatible URL also defines the deployment allowlist. Library hosts can
supply `ApiOptions.ai`, including multiple trusted compatible endpoints.
Model IDs are configured explicitly; availability is checked by Test connection.
Changing provider or endpoint discards the saved key; changing model retains it.

Transport checks use a 20-second timeout, bounded responses, disabled redirects,
no automatic retries, and sanitized `AI_*` diagnostics. No upstream error body or
key is returned. Builds/tests inject transports and make no provider or AWS calls.

## Generative O and calculated fields

`GET /api/o/status` is AI-gated and returns only configuration availability/state.
`POST /api/o/generate` takes `{ question, calculatedFields?, dashboardId? }` and
returns the existing O interpretation result. The provider translates to supported
O grammar; unparseable/unsupported replies fail with `O_INVALID_PROVIDER_RESPONSE`
or `O_UNSUPPORTED_QUESTION`. Generative mode broadens phrasing, not the current
query/visual feature set. Preview queries use `/api/o/query` and RLS/CLS.

`POST /api/o/calculation` additionally requires build capability. It returns a
validated calculated-field suggestion for review/insert, with no automatic draft
mutation. The server binds actual fields, checks calculation dependencies and
column access, and rejects unknown functions, fields and parameters. Original
row/column protection applies to later execution.

Provider prompts contain question text and permitted field names/types only.
No rows, credentials, principal identifiers, or dataset ARNs are sent. Row denial
blocks calls, denied columns are excluded, and supplied calculations cannot
indirectly disclose denied columns. Role, grants, and policies are checked again
after provider I/O. Client edits discard pending stale suggestions; failures do
not fall back to fixtures or deterministic results.

## User management and invitations

The administrator-only Users and invitations page lists registered namespace
users, edits names/roles, removes unreferenced users, creates invitations and
revokes pending invitations. The last administrator cannot be removed or demoted.
Existing `GET /api/users` and `GET|PUT|DELETE /api/users/{id}` retain atomic
validation and referential checks. Changes take effect on the next API request;
the hosted UI refreshes its session on focus and every 30 seconds.

- `GET /api/invitations`: namespace pending invitations, without tokens/digests.
- `POST /api/invitations`: `{ id, name, role }`, creates a seven-day invitation;
  returns its single-use token once. Share the generated fragment link manually.
- `DELETE /api/invitations/{id}`: revoke by invited user ID.
- `POST /api/invitations/accept`: `{ token }`; verifies credentials through the
  deployment's trusted authentication callback even before registry enrollment.

Acceptance requires the exact invited user ID and namespace from verified
credentials, a nonexpired token, and an inviter who is still an administrator.
The server atomically creates the user with the saved role and consumes the
invitation. Concurrent acceptance succeeds only once. Only SHA-256 token digests
are persisted. Body roles/identities are rejected. Tokens never appear in list
responses or URL query parameters. Expiry, revocation, replay and identity
mismatch have named `SECURITY_INVITATION_*` errors. The sign-in provider must
already recognize the invited identity; invitations do not create credentials or
send email. This is stated in the UI.

## Verification (2026-09-28)

Final root `npm test` exited 0 with `TZ=UTC` and the supplied local PostgreSQL
connection. Live PostgreSQL ran; no tests were skipped.

| Stage | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 114 | 0 | 0 |
| Bundle parser | 183 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 367 | 0 | 0 |
| Web | 442 | 0 | 0 |
| Conformance | 3 | 0 | 0 |
| **Total** | **1,145** | **0** | **0** |

Strict TypeScript and public consumer checks are included in the suite.
`git diff --check` passed. Provider transports were stubbed; no live provider or
AWS calls were made. No new third-party dependencies were added; the API now
uses the existing Apache-2.0 O interpreter workspace. Browser verification and
reference comparisons are recorded in [Issue #7 gap notes](issue-7-gap-notes.md).
All changes are checkpointed on `work/issue-7-roles-settings`. No merge, publish,
or static-demo rebuild was performed; SOLUTION_DESIGN.md is unchanged.
