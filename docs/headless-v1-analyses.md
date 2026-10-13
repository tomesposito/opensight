# Headless v1 — analyses slice (issue #95)

Status: **🚧 Contract proposal; implementation blocked on product review.**
Prepared on `work/issue-95-analyses`, 2026-10-13. No analysis endpoints
have been added to v1. Existing routes and the shipped machine-readable
contract in `docs/api/openapi-v1.yaml` remain unchanged.

The [frozen contract](api-contract-v1-draft.md#freeze-decisions-product-owner-2026-10-13)
answers all seven freeze questions, and IDDs [D-37](idd/D-37-headless-first-api.md)
and [D-38](idd/D-38-dashboard-publish-semantics.md) are confirmed on the
branch's master base. Freeze Q5 explicitly reserves product review of
analysis verbs; it does not approve their shape. The run brief, scope §4,
says to name unresolved product questions here and stop before inventing
their answers. [Draft IDD D-39](idd/D-39-headless-analysis-authoring.md)
records this gate. Nothing below is a frozen API commitment.

## Existing behavior and implementation seams

- Local `GET /analyses` and `GET /analyses/{id}/definition` live in
  `packages/api/src/index.ts`. The definition response uses the existing
  PascalCase QuickSight envelope. `OrganizationService` filters assets
  by build capability, asset grants and folder grants when authentication
  is configured.
- `packages/api/src/store.ts` is a startup snapshot reader. Despite the
  brief's description of file-backed persistence, `DefinitionStore`
  exposes only `load`, `list` and `get`; it has no save or delete method.
  Browser draft persistence is separate (D-17).
- There is no general hosted analysis CRUD route, but embedded-console
  authoring already saves analyses through `EmbedContent.save` and
  `TenantMetadata.saveEmbeddedAnalysis`. That path accepts one legacy
  `dataset` binding, uses build capability plus co-owner/folder grants,
  preserves grants and placement, and checks an integer version. This
  is evidence to reuse, not an approved v1 access policy.
- Hosted metadata currently permits analysis `datasets` links only to
  legacy `dataset` resources. The v1 datasets/querying slices instead
  expose owner-scoped `prepared-dataset` resources. Substituting those
  IDs would not create a valid analysis binding. HQ-4 still prohibits
  prepared-dataset sharing; an analysis grant cannot widen data access.
- `BundleDefinition` is camelCase and preserves unknown properties.
  `convertDefinition` projects the PascalCase API representation into
  that shape; it explicitly is not an execution validator. Bundle
  validation also preserves opaque configuration. The UI additionally
  uses `normalizeVisual`/`compileVisual` and `calculationError`, which
  calls the shared query-engine `parseExpression` function library.
  Exposing only bundle parsing as mutation validation would be unsound.

## Proposed endpoints (`/api/v1/...`, both planes) — review required

The recommendation is resource routes with explicit create/update/delete
operations, plus whole-definition replacement for batch authoring. The
alternative is whole-definition replacement alone. The latter reduces
the API surface but requires every agent to construct an entire document
to change one visual. All names and paths below are proposals, including
the `operationId` values that would map mechanically to MCP tools.

| Method and path | Proposed operationId | Proposed body / result |
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

Subresource mutations would return the updated describe envelope and
`ETag`. Definitions in mutation requests would be camelCase
`BundleDefinition`; describe would retain the existing PascalCase
QuickSight projection. This asymmetric wire representation is explicitly
part of the review, not an accidental casing conversion. The alternative
is PascalCase request and response definitions throughout.

Layouts have no required resource ID in `BundleSheet`; replacing their
array avoids inventing one. Filter groups already have stable identities
and scope. Calculated fields are identified by dataset identifier and
name, which may contain characters unsuitable for simple ID routes;
array replacement also permits coordinated dependency changes. Review
must confirm that these collection operations satisfy the builder-facing
granularity requirement. Whole-definition replacement would cover sheet,
parameter, theme and other document edits without inventing additional
verbs in this slice.

## Product questions requiring answers

| Question | Recommendation for review | Alternative / consequence |
| --- | --- | --- |
| Q1 — Verb granularity, naming and wire casing | Approve the proposed table and camelCase writes / existing PascalCase reads | Coarse CRUD only, individual layout/filter/calculation verbs, or a single PascalCase wire shape; MCP names follow the approved REST operations |
| Q2 — Who can create, edit and delete? | Create requires build capability; new analyses grant the creator co-owner access. Edit/delete require build capability and co-owner access through both asset and folder restrictions, preserving existing administrator behavior. Grants/placement cannot be overwritten through definition bodies | Administrator-only writes or a new owner-private analysis model would have different collaboration behavior. Existing imported analyses with absent grants also need an explicit compatibility rule; proposed rule is the existing embedded-console behavior |
| Q3 — Concurrent edits to different visuals | One version for the entire analysis; every update/subresource mutation/delete requires its current `If-Match`. One of two edits based on the same version succeeds; the other conflicts and must reread/reapply | Per-visual versions or automatic merging permit more concurrent writes but change the unit of consistency and retry behavior |
| Q4 — Which datasets can new analyses bind? | Explicit bindings keyed by dataset identifier, with typed legacy/prepared references. Prepared references are resolved as the authenticated owner only, with no sharing or grant-based data access. Every declaration must resolve before save; cross-owner queries/edits fail closed | Legacy-dataset-only authoring follows the embedded path but cannot author against the prepared datasets exposed by v1. Prepared-only authoring cannot round-trip imported legacy bindings. Supporting both requires metadata-link work and security tests |
| Q5 — Can agents save unfinished UI drafts? | Permit empty sheets and incomplete field wells that the UI can represent, but return validation diagnostics for non-executable visuals. Never admit invalid calculations or unresolved/denied dataset bindings | Require every visual to be executable before saving, or preserve additional opaque imported features as read-only content. This changes whether agents can build incrementally and how imported definitions round-trip |

Q2 does not propose changing HQ-4. Shared analysis visibility and access
to its underlying prepared data are separate: an analysis grant never
authorizes another owner's prepared dataset. The review must settle the
experience when a permitted analysis editor cannot access its bindings.
Q4 also needs an exact binding JSON schema before implementation; client
tenant, user or arbitrary ARN assertions cannot be execution authority.

For Q3, the recommended HTTP convention is the existing quoted integer
`ETag`/`If-Match` pattern: missing precondition returns 428
`V1_IF_MATCH_REQUIRED`, malformed returns 400 `V1_IF_MATCH_INVALID`, and
stale versions use 409 `METADATA_CONFLICT`. Successful edits increment
once. There would be no silent cascading removal of dependent visuals,
filters or calculations; dangling references would reject the mutation.
Deletes would preserve already-published dashboard definitions per D-38,
with any remaining reference/retention policy reviewed by its owning slice.

## Conventions and validation to preserve after review

- Extend `V1Routes`; keep unversioned paths working. Use `Limit`/`Cursor`
  request headers, `{ items, nextCursor }` lists, named `errorCode`
  failures, per-tenant 429 `RATE_LIMIT_EXCEEDED` with `Retry-After`, and
  current authorization checks before returning definitions or replays.
- Honor `Idempotency-Key` on every mutation using the established replay
  convention. Serialize concurrent edits; replay cannot bypass current
  access, repeat a write, or silently accept a different payload. The
  existing cache does not alone prove these properties for new writes.
- Reuse the UI's expression parser/function library and visual validation
  through shared modules, not a second validator. Validate **every**
  calculated field, including unused ones and calculated measure
  expressions; query-time validation of reachable fields is insufficient
  for mutation admission. Check dependencies, cycles, parameter bindings,
  schema types and denied columns against current dataset access.
- Accept no raw SQL, SQL envelopes, custom SQL operators or forged
  principal fields. QuickSight expression strings are input to the
  allowlisted parser only. SQL-looking string literals remain data.
- Local durable writes need an atomic persistence implementation, restart
  recovery and the existing maintenance fence; mutating the startup map
  is not persistence. Local files and hosted metadata must implement the
  same approved mutation/validation semantics without paths derived from
  untrusted IDs. No new dependencies are planned.

## Tests required after contract approval

`packages/api/test/v1-analyses.test.mjs` should use the existing `serving`
harness plus a local-server harness and run through the API/root suites.
No analysis contract tests or implementation are claimed by this proposal.
The build must cover:

- List pagination after access filtering, describe envelopes, local/hosted
  round trips and preservation of unversioned behavior.
- CRUD and every approved authoring verb, malformed bodies, unknown IDs,
  duplicate identities, dependency removal and local restart persistence.
- Role, asset and folder grants; cross-tenant/cross-owner/forged-principal
  bypass attempts; revocation immediately before save/read/replay.
- Required/stale `If-Match`, concurrent edits, retry idempotency,
  conflicting payloads and tenant-wide rate limits on every route.
- Valid shared-library calculations, unused invalid calculations,
  calculated measure expressions, cycles, denied columns and SQL attempts
  such as `SELECT * FROM secrets`, `pg_sleep(1)` and a semicolon followed
  by `DROP TABLE`; all failures carry named error codes and field paths.
- Whole-definition and subresource mutations yielding the same validation
  results, including whatever incomplete-draft policy Q5 approves.

## Resume boundary

The current checkpoint is contract discovery and a reviewable proposal.
No proposed mutation has been implemented or published in OpenAPI. After
product answers Q1–Q5, record the approved contract, then implement and
checkpoint the routes, shared validation, persistence and contract tests.
The hosted visual-query alias remains deferred; this proposal does not
silently resolve its binding/access dependency.

## Baseline verification

Full root `npm test` exited 0 on 2026-10-13: **2,646 passed / 0 failed /
18 skipped / 0 cancelled**. Every skip explicitly requires live PostgreSQL
(`DATABASE_URL` is unset). These are the existing tests; this documents
the baseline at the review gate, not implemented analysis API coverage.

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

The initial sandboxed run was interrupted after existing HTTP tests
reported `listen EPERM` on loopback sockets. The complete rerun outside
that restriction produced the counts above. Runtime sources, dependency
manifests, `SOLUTION_DESIGN.md` and the shipped OpenAPI contract match
the master base; proposal links resolve locally. Nothing has been merged
or pushed.

The static demo rebuilt successfully. Three offline captures are
byte-identical to the previous slice's captures; reference comparison
and local artifact locations are recorded in the
[gap notes](issue-95-analyses-gap-notes.md).
