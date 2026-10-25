# Headless v1 — analyses slice (issue #95)

Status: **Implemented**, 2026-10-14, on `work/issue-95-analyses-impl`.
The 13 approved REST operations are implemented for local files and hosted
metadata. Serverless `/api/v1` integration, dashboards, assets and MCP remain
separate slices. This branch is not pushed or deployed.

## Confirmed contract

Product owner confirmations dated 2026-10-14 were verified against master
and the fetched `origin/master` before implementation. The branch starts at
`44ee0e3f`; local master was older and was not used as the build base.

| Decision | Confirmed behavior |
| --- | --- |
| [D-39](idd/D-39-headless-analysis-authoring.md) | Whole-definition CRUD plus resource operations; one version and validation path |
| [D-43](idd/D-43-analysis-verb-granularity-naming.md) | Frozen verbs below; camelCase writes and PascalCase reads |
| [D-44](idd/D-44-analysis-authoring-access.md) | Build capability, creator co-owner, asset and folder restrictions |
| [D-45](idd/D-45-analysis-concurrent-edits.md) | Mandatory quoted-integer `If-Match`, one successful version increment, no cascading dependency removal |
| [D-46](idd/D-46-analysis-dataset-bindings.md) | Explicit typed bindings resolved only as the authenticated owner |
| [D-47](idd/D-47-analysis-unfinished-drafts.md) | Empty sheets and incomplete field wells persist; calculations and bindings must be valid |

[D-37](idd/D-37-headless-first-api.md) remains the REST/OpenAPI, credentials,
SQL and rate-limit contract. [D-38](idd/D-38-dashboard-publish-semantics.md)
requires analysis deletion to preserve published dashboard definitions.
There are no outstanding product questions in this slice.

## Endpoints (`/api/v1/...`)

| Method and path | operationId | Body / result |
| --- | --- | --- |
| `GET /analyses` | `list_analyses` | Paginated existing `{ kind, id, name }` summaries |
| `GET /analyses/{id}` | `describe_analysis` | `{ AnalysisId, Name, Definition, Errors }` plus version in `ETag` |
| `POST /analyses` | `create_analysis` | `{ analysisId, name, definition, datasetBindings }`; 201 with describe envelope and `ETag` |
| `PUT /analyses/{id}` | `update_analysis` | `{ name, definition, datasetBindings }`; replace working draft, 200 with describe envelope and `ETag` |
| `DELETE /analyses/{id}` | `delete_analysis` | No body; 200 `{ id, removed: true }` |
| `POST /analyses/{id}/sheets/{sheetId}/visuals` | `add_visual` | One `BundleVisual`, including its `visualId` |
| `PUT /analyses/{id}/sheets/{sheetId}/visuals/{visualId}` | `update_visual` | One replacement `BundleVisual`; identity must match path |
| `DELETE /analyses/{id}/sheets/{sheetId}/visuals/{visualId}` | `remove_visual` | No body |
| `PUT /analyses/{id}/sheets/{sheetId}/layouts` | `set_layouts` | The sheet's complete `BundleSheet.layouts` array; `[]` removes layouts |
| `POST /analyses/{id}/filter-groups` | `add_filter_group` | One existing bundle filter-group value |
| `PUT /analyses/{id}/filter-groups/{filterGroupId}` | `update_filter_group` | Replacement group, including its filters; identity must match path |
| `DELETE /analyses/{id}/filter-groups/{filterGroupId}` | `remove_filter_group` | No body |
| `PUT /analyses/{id}/calculated-fields` | `set_calculated_fields` | Complete `BundleDefinition.calculatedFields` array; `[]` removes fields |


Lists return `{ items, nextCursor }`, with pagination applied after current
asset/folder filtering. Pagination uses `Limit` and `Cursor` request headers.
Subresource mutations return the updated describe envelope and `ETag`.
`Errors` is always an array of `{ errorCode, message, path }` diagnostics.
The complete machine contract, including request schemas and response codes,
is in [openapi-v1.yaml](api/openapi-v1.yaml).

Whole replacement also covers sheets, parameters, themes and other
`BundleDefinition` members; no extra resource verbs were introduced.
The inverse of the UI's named-member converter produces PascalCase reads,
while opaque non-executable properties retain their spelling and values.
PascalCase writes are rejected.

## Dataset binding schema and authorization

The binding JSON schema was pinned in OpenAPI before runtime implementation:

```json
{
  "sales": { "kind": "dataset", "id": "legacy-sales" },
  "prepared": { "kind": "prepared-dataset", "id": "prepared-sales" }
}
```

Each object contains exactly `kind` and `id`. Keys must match every
`dataSetIdentifierDeclarations[].identifier` exactly, without missing or
extra bindings. Legacy IDs use `[A-Za-z0-9_-]{1,512}`; prepared IDs use
`[A-Za-z0-9_-]{1,128}`. Dataset ARNs remain definition labels; they never
select an execution principal or source. Tenant, namespace, user, owner,
principal, grants and folder assertions in request bodies are rejected.

Hosted prepared references become metadata links with the authenticated
user's owner ID supplied by the server. Reading, editing or replaying an
analysis never grants access to another owner's prepared dataset, even if
the caller has co-owner or administrator access to the analysis. Legacy
bindings resolve their existing source link and require the same owner;
source and dataset policies are intersected for schema admission. Missing
policies on protected legacy datasets fail closed. Imported local legacy
bindings resolve only the configured sales fixture's exact startup ARN.

Creation requires build capability and assigns the creator a co-owner
grant. Edit/delete additionally require co-owner access through both asset
and folder grants. Administrators retain the existing asset-grant bypass;
this does not bypass dataset ownership. Imported assets without grants
retain embedded-console inherited access. Definitions cannot overwrite
grants or placement. Authorization is checked again before publication.

## Validation and unfinished drafts

Whole-definition and resource mutations construct the same candidate
`BundleDefinition` and enter `validateAnalysisDefinition`. It reuses the
UI's `parseExpression` function catalog, `ExpressionBinder`, parameter
library and visual compiler, plus the existing shared visual query planner.
There is no SQL evaluator or separate expression grammar.

Admission resolves every binding and validates **every** calculated field,
including unused fields, calculated measure expressions, dependencies,
cycles, parameter defaults/bindings, schema types and denied columns.
SQL envelopes and custom operators are rejected. Expressions such as
`SELECT * FROM secrets`, `pg_sleep(1)` and a semicolon followed by
`DROP TABLE` fail with named errors and field paths. SQL-looking quoted
string literals remain ordinary data.

Sheet, visual, filter-group and field identities must be unique. Layout,
filter scope, parameter, column, calculation and action references must
resolve. Removing a referenced item rejects the candidate; no dependent
content is silently removed. Coordinated changes can use whole replacement.

Empty sheets are valid. Incomplete field wells and unsupported visual query
semantics are stored with `ANALYSIS_VISUAL_NOT_EXECUTABLE` diagnostics in
`Errors`. The compiler/planner reports the current execution limitations;
these diagnostics do not claim broader query or rendering parity. Invalid
calculations and unresolved/denied bindings remain hard failures.

## Versions, retries and persistence

Every update, resource mutation and delete requires the current `If-Match`:

| Condition | Status / errorCode |
| --- | --- |
| Missing | 428 `V1_IF_MATCH_REQUIRED` |
| Malformed or unquoted | 400 `V1_IF_MATCH_INVALID` |
| Stale | 409 `METADATA_CONFLICT` |
| Reused idempotency key with different payload/precondition | 409 `IDEMPOTENCY_CONFLICT` |
| Tenant rate limit exceeded | 429 `RATE_LIMIT_EXCEEDED` plus `Retry-After` |

The analysis version advances exactly once per successful edit. Hosted
writes check access, data/security revisions and the analysis version in
the same metadata transaction. Working-definition edits do not advance
security/data revisions: doing so would invalidate concurrent bearer
sessions instead of returning the specified version conflict. Access and
binding checks always use current metadata. The loser rereads and reapplies.

`Idempotency-Key` uses the existing ten-minute, process-local convention.
The cache is scoped by tenant, namespace, user, method and path, binds the
payload and precondition, and serializes both the retry key and the analysis.
Concurrent creates with different IDs cannot commit under the same key.
Replays recheck current asset/folder and dataset access. Delete replays
retain the prior access snapshot for checks against current principals and
folders; recreation of the ID prevents replaying the old delete. Successful
responses are recorded after commit and before HTTP publication, so a
connection loss cannot make a retry repeat that write.

Analysis receipts share the [dataset/query retry capacity budgets](headless-v1-datasets.md#retry-receipt-capacity).
Accounting includes the full reply, retained record/definition and access
snapshot. Capacity is reserved before committing analysis edits, so 429
`IDEMPOTENCY_CAPACITY_EXCEEDED` (`Retry-After: 60`) leaves the analysis unchanged.
Retained retries still perform the access and definition checks above.
Resource DELETEs are handled by the asset router and retain its separate cap.

Local unauthenticated file workspaces persist an atomic overlay beside the
trusted startup root: `.opensight-analyses.json` within a directory root,
or a hidden sibling of a single-file root. No resource ID becomes a path.
Updates use copy-on-write, file/directory sync and atomic rename under the
existing legacy maintenance lock/fence. Tombstones prevent deleted imported
analyses from reappearing after restart. The local store retains its existing
single-process ownership model.

Authenticated local workspaces store analysis definitions, bindings,
versions, creator grants and tombstones together in the configured durable
security store (`SecurityOptions.storePath`). A library configuration that
omits that path remains ephemeral for existing routes; v1 mutations fail
with `ANALYSIS_DURABLE_STORE_REQUIRED` rather than claim persistence.
Local prepared bindings retain a server-owned identity pin: a different user
with a same-ID prepared dataset cannot substitute their dataset, including
through administrator access. Prepared bindings use the existing owner-scoped
prep/source resolver; restartable local uploads/prep additionally require their existing durable
store paths. Unversioned list/definition routes see the same saved drafts.

Hosted metadata persists both legacy and owner-scoped prepared links with
referential constraints. Analysis deletion removes only the working
analysis and its outgoing links; already-published dashboard definitions
remain unchanged. No Lambda integration or durable distributed replay/rate
state was added; those remain the remote serverless handoff.

The existing TypeScript headless SDK now maps all 13 operations. Analysis
reads and edits return `{ value, etag }`, preserving the PascalCase wire
envelope in `value`; updates require `ifMatch` in their options. Every
mutation accepts `idempotencyKey`. Pagination remains header-based.
The SDK imports canonical bundle types through a type-only reference to the
existing Apache-2.0 `@opensight/bundle-parser` workspace package. No external
dependencies were added. No AWS calls, network builds, merges or pushes were
performed. `SOLUTION_DESIGN.md` is unchanged.

## Verification

`packages/api/test/v1-analyses.test.mjs` is included by the existing API
`test/*.test.mjs` script and therefore by root `npm test`. It uses the shared
hosted `serving` harness and temporary local servers/stores. Coverage includes
all approved verbs, access-filtered pagination, every mutation's replay and
preconditions, concurrent writers, local and hosted recovery, grants,
revocation, owner/tenant isolation, injection, calculations, draft diagnostics,
reference removal, dashboard preservation, maintenance fencing and the
OpenAPI operation/binding contract.

Full root `npm test` exited 0: **2,701 passed / 0 failed / 18 skipped /
0 cancelled** (2,719 tests). Every skip explicitly requires live PostgreSQL
(`DATABASE_URL` is unset). These counts come from one complete run of the
final implementation, including all 24 analysis contracts and 23 SDK tests.
The SDK OpenAPI coverage test caught the missing analysis client methods in
an earlier run; those methods and transport tests were added before this
successful run.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 537 | 0 | 16 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 23 | 0 | 0 |
| Interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 504 | 0 | 2 |
| Web | 1,328 | 0 | 0 |
| Root conformance | 57 | 0 | 0 |

The static demo and required local shim were rebuilt from the tested code.
All three offline captures are byte-identical to the preceding slice, with
zero page errors or external requests. Reference differences remain 41.22%
(classic), 33.58% (new-look), and 44.66% (Q); these are pixel differences,
not fidelity grades. The [gap notes](issue-95-analyses-gap-notes.md) record
the capture timing adjustment and unchanged gaps. No new visible issue was
introduced and README media is unchanged. This is a local static artifact,
not a deployed server.

OpenAPI internal references and document links resolve. `git diff --check`
passes. No product-owner action is required for this slice.

### Proposal baseline (2026-10-13)

The proposal's root run had **2,646 passed / 0 failed / 18 skipped**.
All skips required live PostgreSQL. These counts describe the previous
review gate, not the implementation's final verification.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 513 | 0 | 16 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 504 | 0 | 2 |
| Web | 1,320 | 0 | 0 |
| Root conformance | 57 | 0 | 0 |
