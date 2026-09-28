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
