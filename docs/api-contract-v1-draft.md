# OpenSight headless API contract — v1 DRAFT

Status: 🚧 Draft for product-owner review
Owner: Tom Esposito
Date: 2026-10-13
Issue: [#95](https://github.com/tomesposito/opensight/issues/95) — Headless-first: open API for everything so agents can build
Decision: `docs/idd/D-37-headless-first-api.md` (✅ confirmed 2026-10-13)

This draft **freezes the shape of the contract, not its implementation**.
It says which endpoints v1 has, what they are called, and the conventions
they share. It is built only from what the codebase already does today —
no endpoint is invented here. Where the vision needs something that does
not exist yet, the draft names the gap instead of filling it.

Nothing in this draft changes the product decisions in D-37 or the issue.
Where a choice is still open, it is marked **PROPOSAL** and listed in
[Open questions](#open-questions-for-the-freeze), for Tom to confirm.

## What "frozen" means

- Frozen = the endpoint list, paths, methods, and conventions below do not
  change without a version bump and migration notes (D-37: versioned and
  stable).
- The machine-readable OpenAPI YAML is generated from this draft when the
  first resource-area slice lands; the slices also add contract tests per
  area (datasets, querying, analyses, dashboards, assets), and the MCP
  server is its own slice on top of the REST foundation.
- The UI consumes the same API (D-37). Any endpoint the UI can hit must
  keep working for the UI during the migration to versioned paths.

## Conventions

### Versioning and base URL

- **PROPOSAL:** the headless v1 surface lives at `/api/v1/...`. The
  existing unversioned routes (`/api/...`, `/analyses/...`,
  `/dashboards/...`) keep working — the web app is one of their clients,
  and D-37 says the UI must keep consuming the same API.
- New endpoints appear only under the versioned prefix. Breaking changes
  need `/api/v2` plus migration notes.

### Auth

- Bearer tokens on every route (already the client convention:
  `Authorization: Bearer <token>`, `packages/web/src/api-client.ts`).
- Credentials are **user-level and tenant-scoped** (D-37 decision 4). A
  credential belongs to a user and can only act inside that user's tenant.
- **PROPOSAL:** agent credentials are minted through the existing
  operator invitation path — `POST /api/invitations` (operator, names the
  role), `POST /api/invitations/accept` (redeems the token), revocation
  via `DELETE /api/invitations/{id}` (`packages/api/src/invitations.ts`,
  `namespace-routes.ts`). No parallel service-principal system. The
  freeze should pin the credential shape (long-lived token vs. renewable
  short session) — see open questions.

### Errors

- Named error codes in every error body, machine-first (D-37). This is
  already the codebase convention, e.g. `{"errorCode": "RESOURCE_NOT_FOUND",
  "Message": "..."}` with the matching HTTP status.
- Validation failures on a field carry the failing path
  (`{"errorCode": "...", "message": "...", "path": "..."}`), as the query
  path already does (`QueryError`).
- New contract-level codes to standardize (D-37 decision 5): a single
  rate-limit code, e.g. `RATE_LIMIT_EXCEEDED`, returned with HTTP 429 and
  a `Retry-After` header. Rate limiting exists as a requirement today, not
  as code — every new v1 route ships with it.

### Pagination

- **PROPOSAL:** list endpoints take `limit` (default 100, max 1000) and
  an opaque `cursor`, and return `{ items: [...], nextCursor: "..." | null }`.
  Existing list endpoints (`/api/assets`, `/analyses`, `/dashboards`,
  `/api/datasets`, `/api/prep-datasets`, `/api/users`, `/api/jobs`) return
  full arrays today; they keep doing so on the unversioned paths and gain
  pagination only under `/api/v1`. This keeps the freeze honest: we are
  not claiming pagination the code already has.

### Idempotency

- `Idempotency-Key` is already honored on the durable mutation paths
  (upload reserve/complete, artifact writes —
  `packages/api/src/runtime-ingress.ts`, `durable-uploads.ts`,
  `artifact-writes.ts`), and the web client already sends it.
- **PROPOSAL:** every `POST`/`PUT` under `/api/v1` accepts and honors
  `Idempotency-Key`. Safe to state now because the durable-dispatch
  machinery the keys ride on already exists.

### Tenant scope

- Every v1 route is tenant-scoped by the credential; there is no
  cross-tenant read (HQ-2: the operator plane stays separate from the
  tenant plane; HQ-4: pilot assets stay owner-private).
- The operator plane (`/api/host/...`) is **not** part of the headless v1
  contract — it is Tom's territory and stays there.

## Endpoint inventory

"Exists today" means the route is implemented in the repo right now,
cited by file. "Gap" means the vision needs it and nothing exists —
the slice that owns the area designs it, and the freeze does not
pre-approve a shape.

### 1. Datasets

Exists today (hosted plane unless noted):

- `GET /api/connectors`, `POST /api/connectors/{id}/connect` —
  connector catalog and credential validation
  (`packages/api/src/connector-routes.ts`, `hosted-data-routes.ts`).
- `GET /api/sources`, `GET /api/prep-sources` — source discovery
  (`hosted-data-routes.ts`).
- `PUT /api/sources/{id}` — create/bind a source (201);
  `GET /api/sources/{id}` — schema inspection;
  `POST /api/sources/{id}/refresh` — refresh a source
  (`hosted-data-routes.ts`).
- `GET /api/prep-datasets`, `POST /api/prep-datasets/import` —
  prepared-dataset list and import (`hosted-data-routes.ts`).
- `GET /api/datasets/{id}/prep`, `PUT /api/datasets/{id}/prep`,
  `DELETE /api/datasets/{id}/prep` — prepared pipeline CRUD
  (`hosted-data-routes.ts`); local plane has the same three plus
  `POST /api/datasets/{id}/prep/preview` (`packages/api/src/prep-routes.ts`).
- `POST /api/datasets/{id}/prep/preview` — hosted preview
  (`hosted-data-routes.ts`).
- `GET /api/datasets/{id}/execution`, `PUT /api/datasets/{id}/execution`
  — Blaze/cache configuration; `POST /api/datasets/{id}/refresh`,
  `GET /api/datasets/{id}/rows`, `GET /api/datasets/{id}/refresh-status`
  (`packages/api/src/blaze.ts`, `prep-routes.ts`).
- `GET /api/datasets/{id}/row-rules`, `/column-grants` — RLS/CLS bindings
  (`packages/api/src/security.ts`).
- Upload durability primitives: `POST /api/uploads`,
  `GET|DELETE /api/uploads/reservations/{id}`,
  `GET|DELETE /api/operations/{id}`
  (`packages/api/src/upload-routes.ts`, `durable-uploads.ts`).
- Refresh/alert/report automation: `GET|PUT|DELETE
  /api/datasets/{id}/refresh-schedules...`, `GET /api/refresh-schedules`,
  `GET /api/alert-rules`, `GET /api/jobs`, `POST /api/jobs/{id}/runs`
  (`automation-routes.ts`, `job-routes.ts`).

Gaps (named, not designed):

- **Lineage.** No endpoint exposes where a dataset's data comes from
  (sources, prep steps, refresh history) as a single machine-readable
  graph. The pieces exist (prep pipeline, sources, refresh state); the
  composed view does not.
- **Dataset deletion on the hosted plane.** Prep delete exists; source
  lifecycle deletion needs a freeze pin-down against the durability
  protocol (see #91 territory).
- Schema inspection is per-source; a single "describe dataset"
  (columns, types, grain, refresh state) is composed client-side today.

### 2. Querying

Exists today:

- `POST /api/datasets/{id}/query` — runs the dataset's query model and
  returns `{ columns, rows, execution? }`. Local plane
  (`packages/api/src/index.ts`); hosted plane executes via
  `POST /api/datasets/{id}/query` (`hosted-data-routes.ts`, `hosted-data.ts`).
- `POST /api/o/query` — the generative path's query entry
  (`packages/api/src/o-routes.ts`).
- Long-running work surfaces as operations:
  `GET|DELETE /api/operations/{id}` with status polling
  (`upload-routes.ts`, web `getOperation`/`cancelOperation`).

Contract rules (from D-37, decision 2):

- **No raw SQL through the API.** Agents submit the visual query model
  (`InteractiveQuery`: dimensions, measures, filters — the same model the
  UI already sends, `packages/web/src/api-client.ts`) plus basic
  parameterized filters. The API never accepts arbitrary SQL text; the
  injection surface is closed by construction.
- Result shape is stable: `{ columns: [{name, type}], rows: [...] }`,
  with `execution` provenance when the dataset is cached. Row values are
  `string | number | null` per column type — no surprises for agents.

### 3. Analyses

Exists today:

- `GET /analyses` — list analyses; `GET /analyses/{id}/definition` —
  read an analysis definition in the QuickSight-shaped envelope
  (`{ AnalysisId, Name, Definition, Errors }`, `packages/api/src/index.ts`).
- `GET|PUT|DELETE /analyses/{id}/shares(/user/{userId}|/group/{groupId})`
  — share grants (`packages/api/src/sharing.ts`).
- `POST /analyses/{id}/visuals/{visualId}/query` — run one visual's query
  (`packages/api/src/sharing.ts`).

Gaps (named, not designed) — this is the largest one:

- **Create / update / delete an analysis.** The local plane persists
  through the file-backed `DefinitionStore`; the hosted plane has no
  write endpoint for analyses at all.
- **Authoring operations as API calls:** add/modify/remove visuals,
  layouts, filters, calculated fields. The definition shape agents would
  manipulate already exists — it is the same `BundleDefinition` the UI
  reads and writes (`packages/web/src/definition-converter.ts`) — but
  the mutations are UI-only today. The slice designs the verbs; the
  freeze does not pre-approve them.

### 4. Dashboards

Exists today:

- `GET /dashboards` — list; `GET /dashboards/{id}/definition` — read in
  the QuickSight-shaped envelope (`packages/api/src/index.ts`).
- `GET|PUT|DELETE /dashboards/{id}/shares(/user/{userId}|/group/{groupId})`
  (`packages/api/src/sharing.ts`).

Gaps (named, not designed):

- **Publish.** The UI's PUBLISH is an honest stub today (AGENTS.md §4:
  "PUBLISH (honest stub until hosted)"). Publish semantics (snapshot a
  definition into a read-optimized dashboard, version it) are a
  product-shaped decision the slice must bring back if anything in it is
  ambiguous.
- **Snapshot / export as API calls.** Report rendering and snapshot
  machinery exist (`packages/api/src/reports.ts`, `job-renderer.ts`);
  there is no dashboard-scoped endpoint for them.

### 5. Assets and admin

Exists today:

- `GET /api/assets` — unified asset list across analyses, dashboards,
  datasets (`packages/api/src/index.ts`).
- Namespaces, users, groups: `GET /api/namespaces`,
  `GET|PUT|DELETE /api/users/{id}`, `/api/groups/{id}`
  (`namespace-routes.ts`, web `listUsers`/`saveUser`/`deleteUser`).
- Invitations: `POST|GET /api/invitations`, `DELETE /api/invitations/{id}`,
  `POST /api/invitations/accept` (`invitations.ts`).
- Auth: `POST /api/auth/login|logout|enroll|accept|switch`,
  `GET /api/session` (`hosted-auth.ts`, `namespace-routes.ts`).
- Embedding (QuickSight-compatible shapes, HQ-6/HQ-12):
  `POST /api/embedding/GenerateEmbedUrlForRegisteredUser`,
  `POST /api/embedding/GenerateEmbedUrlForAnonymousUser`,
  `GET /api/embedding/config`, `GET|POST /api/embedding/sessions`
  (`embedding.ts`, `embed-session-routes.ts`).
- AI provider admin: `GET|POST /api/admin/ai`, `POST /api/admin/ai/key`,
  `POST /api/admin/ai/test` (`ai-providers.ts`, `ai-settings.ts`).

Gaps (named, not designed):

- **Search.** There is a list but no search endpoint (name/type/owner
  query). The UI's global find-anything search is client-side.
- **Move.** No asset move/rename endpoint (folders exist as a concept;
  the API has no verb for moving an asset between them).
- **Permissions beyond shares.** Dataset row/column grants exist;
  analysis/dashboard permission verbs beyond share grants do not.

## Out of scope for v1

From #95 and D-37: billing/metering on API usage (gated behind HQ-14
entitlement work), multi-region, SLAs. The pilot API is single-tenant-
scoped like everything else. The operator plane (`/api/host/...`) is not
in this contract.

## Freeze decisions (product owner, 2026-10-13)

Questions 1–5 and 7 are frozen. Question 6 (dashboard publish semantics)
remains open — see below.

1. **Versioned path: `/api/v1/...` — frozen.** The headless surface lives
   under `/api/v1/`; existing unversioned routes are untouched.
2. **Credential shape: secure refresh token — frozen.** Not a long-lived
   API key and not a short browser session. BI data can be sensitive, so
   the security posture must match: a refresh-token flow (short-lived
   access tokens, rotation, revocation) scoped to user-tenant per D-37.
   Provisioning still goes through the operator invitation/minting path.
3. **Pagination: `limit`/`cursor`/`nextCursor` — frozen** on all v1 list
   endpoints.
4. **Dataset describe: composed endpoint — frozen.** A single
   `GET /api/v1/datasets/{id}` returns schema + lineage pointers +
   refresh state, so agents don't have to compose the pieces.
5. **Analysis authoring verbs: agreed as proposed.** The analyses slice
   proposes concrete verbs against the existing `BundleDefinition` shape;
   anything product-shaped comes back for review rather than freezing
   silently.
6. **Dashboard publish semantics: FROZEN 2026-10-13 (IDD D-38 ✅).**
   A dashboard is a read-only version of the analysis for consuming:
   publishing freezes an immutable versioned *definition* (layout,
   visuals, filters/controls); consumer interactivity is limited to the
   filters/controls added at build time; data stays live so no republish
   is needed as data advances. Versions store the definition only, never
   rendered snapshots. Retention: keep every version by default;
   operator-configured cap allowed. Who-can-publish is pinned down by
   the dashboards slice.
7. **MCP tool naming: mechanical 1:1 mapping — frozen.** REST is the
   source of truth; tool names (`create_dataset`, `run_query`,
   `add_visual`) are a mechanical mapping, not a second design.

## Open questions for the freeze

~~These are the decisions Tom (or the freeze review) must make before any
slice builds. The draft proposes; the review disposes.~~

Resolved 2026-10-13 except #6 above. The remaining freeze questions from
the original draft are answered in "Freeze decisions". Slices whose
dependencies are frozen may build; the dashboards slice waits on #6.

## Slice mapping

- **Datasets slice**: ✅ shipped 2026-10-13 (master: `docs/headless-v1-datasets.md`,
  machine-readable contract `docs/api/openapi-v1.yaml`, contract tests
  `packages/api/test/v1-datasets.test.mjs`). Versioned dataset/source
  surface, lineage view, fail-closed source-deletion pin-down, and the v1
  conventions (named error codes, `Limit`/`Cursor` header pagination —
  headers, not query strings, because the hosted plane rejects `?…` at the
  request boundary — `Idempotency-Key` on mutations, per-tenant rate
  limiting). Upload durability primitives stay unversioned until #91's
  protocol work lands.
- **Querying slice**: version the query endpoints; pin the no-raw-SQL
  rule in tests (injection attempts rejected by construction); contract
  tests for the stable result shape.
- **Analyses slice**: design the authoring verbs against
  `BundleDefinition`; contract tests; bring product-shaped questions
  back for review.
- **Dashboards slice**: publish semantics (after question 6 is answered);
  snapshot/export endpoints; contract tests.
- **Assets slice**: search, move, permission verbs; contract tests.
- **MCP slice**: tool mapping over the frozen REST contract; no new
  semantics.

Each slice needs its contract approved before its build branch — the
§8 discipline (`docs/hosted-architecture.md`) applies: resolve the
listed questions before the dependent slice, rather than inventing
answers during implementation.
