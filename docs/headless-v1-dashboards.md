# Headless v1 — dashboards slice (issue #95)

Status: **✅ Implemented**, 2026-10-14, on `work/issue-95-dashboards-impl`.
The twelve approved dashboard operations run on local durable files and
hosted metadata. Nothing is pushed or deployed. Lambda composition is unchanged.

## Contract and instruction precedence

[D-37](idd/D-37-headless-first-api.md), [D-38](idd/D-38-dashboard-publish-semantics.md),
[D-40](idd/D-40-headless-dashboard-publishing.md), and D-48–D-54 supply the
published-definition, identity, access, lifecycle and export contract.
The implementation brief originally specified an executable-analysis publish
gate that differs from the checked-in decision text. A pre-merge correction
pass (same day) brought the implementation in line with the confirmed
decision:

- [D-49](idd/D-49-dashboard-publish-clean-state.md)'s decision says “Drafts
  permitted with diagnostics.” The correction pass removed the brief's
  executable-analysis gate: drafts now publish with their validation
  diagnostics attached to the version and returned in the 201 response;
  only unvalidatable definitions fail. The IDD is unchanged.
- [D-54](idd/D-54-dashboard-export-shape.md) leaves formats and delivery open
  by format. The brief explicitly selects synchronous CSV and PDF; jobs are
  deferred. This implementation follows those concrete instructions.

The remaining D-54 discrepancy is recorded for decision-document
reconciliation; no new product answer is inferred and neither IDDs nor
`SOLUTION_DESIGN.md` are edited. [D-48](idd/D-48-dashboard-who-can-publish.md),
[D-50](idd/D-50-dashboard-identity.md), [D-51](idd/D-51-dashboard-version-addressing.md),
[D-52](idd/D-52-dashboard-lifecycle.md), and [D-53](idd/D-53-dashboard-reader-share-access.md)
otherwise apply directly.

## Assets slice contract update (D-58–D-61)

The [assets slice](headless-v1-assets.md) now owns the shared share/delete
handlers. Grant GET/PUT/DELETE requires build plus co-owner; PUT requires the
current asset If-Match. Missing asset-delete preconditions return 428.
Latest dashboard describe ETags identify the asset revision, while `Version`
and pinned-version ETags identify the frozen publication. Share reads use PascalCase. These confirmed rules apply to the endpoints below.

## Endpoints (`/api/v1/...`)

| Method and path | operationId | Shipped behavior |
| --- | --- | --- |
| `POST /analyses/{id}/publish` | `publish_analysis` | `{ dashboardId? }`; omit to mint an independent dashboard, supply to append to its active matching source; 201 `{ DashboardId, Version, PublishedAt, Errors }` and quoted-integer ETag |
| `GET /dashboards` | `list_dashboards` | Access-filtered latest-version summaries, sorted by dashboard ID |
| `GET /dashboards/{id}` | `describe_dashboard` | Latest PascalCase envelope with `Version`, `PublishedAt`, `SourceAnalysisId`, and current asset-revision ETag |
| `GET /dashboards/{id}/versions` | `list_dashboard_versions` | Retained `{ version, publishedAt, publishedBy }` entries in ascending version order |
| `GET /dashboards/{id}/versions/{version}` | `describe_dashboard_version` | Exact frozen definition and version ETag |
| `DELETE /dashboards/{id}` | `delete_dashboard` | Removes dashboard and every version; requires latest `If-Match` |
| `DELETE /dashboards/{id}/versions/{version}` | `delete_dashboard_version` | Removes a non-latest version; requires latest `If-Match` |
| `GET /dashboards/{id}/shares/{principalType}/{principalId}` | `get_dashboard_share` | `{ Principal: { Type, Id }, Role }`; build plus co-owner |
| `PUT /dashboards/{id}/shares/{principalType}/{principalId}` | `set_dashboard_share` | `{ role: "viewer" \| "co-owner" }`; build plus co-owner and If-Match |
| `DELETE /dashboards/{id}/shares/{principalType}/{principalId}` | `delete_dashboard_share` | `{ Deleted: true }`; build plus co-owner |
| `POST /dashboards/{id}/versions/{version}/visuals/{visualId}/query` | `query_dashboard_visual` | Live query with optional `{ controlValues: { controlId: [typedValue] } }` |
| `POST /dashboards/{id}/exports` | `create_dashboard_export` | `{ version?, format: "csv" \| "pdf" }`; synchronous attachment, default latest |

`principalType` is exactly `user` or `group`, covering both requested share
paths without duplicate OpenAPI operation IDs. Shares attach to the dashboard
and do not increment or modify published definitions. Mutations use
`Idempotency-Key`; all routes share the existing tenant rate limiter and named
`errorCode` errors. Pagination uses **`Limit` / `Cursor` headers** and
`{ items, nextCursor }`, preserving the existing frozen convention that
rejects query strings. The complete schemas are in
[openapi-v1.yaml](api/openapi-v1.yaml).

| Failure | Status / errorCode |
| --- | --- |
| Source mismatch or severed republish link | 409 `DASHBOARD_SOURCE_MISMATCH` |
| Unvalidatable definition at publish | Validation's named error, with `Errors` |
| Missing, malformed or stale asset delete precondition | 428 `V1_IF_MATCH_REQUIRED`, 400 `V1_IF_MATCH_INVALID`, 412 `ASSET_PRECONDITION_FAILED` |
| Version-prune precondition | 412 `DASHBOARD_PRECONDITION_FAILED` |
| Attempt to prune latest | 409 `DASHBOARD_LATEST_VERSION` |
| Undeclared control, ad-hoc filter, SQL or authority envelope | 422 `DASHBOARD_UNDECLARED_CONTROL` |
| Invalid typed control value | 422 `DASHBOARD_CONTROL_VALUE_INVALID` |
| Prepared recipe input unavailable to reader, or another owner's legacy source | 403 `DASHBOARD_DATASET_ACCESS_DENIED` |
| Different payload under an existing retry key | 409 `IDEMPOTENCY_CONFLICT` |
| Tenant rate exceeded | 429 `RATE_LIMIT_EXCEEDED`, with `Retry-After` |

Unresolved/denied datasets and invalid calculations preserve their existing
named admission errors; publication attaches located `Errors` diagnostics to
the version (drafts publish with diagnostics per D-49) and creates no
dashboard/version when the definition cannot be validated.

## Storage, concurrency and authorization

Publication reuses `validateAnalysisDefinition`, including the shared parser,
compiler, dataset resolver and query planner. Build capability and source
co-owner/folder access are checked before publication. Source version and
current security revisions are checked at commit. Publication preserves
existing dashboard grants and placement; new dashboards receive the creator's
co-owner grant. Delete/prune reuse build capability and dashboard co-owner
access, including folder restrictions. Grant management requires build plus co-owner (D-58).

Local unauthenticated workspaces extend the existing atomic
`.opensight-analyses.json` overlay with dashboard histories. Authenticated
local workspaces persist histories and grants together in the configured
security store; missing durable configuration fails closed. IDs never become
filesystem paths. Copy-on-write, file/directory sync, atomic rename and the
legacy maintenance fence apply. Persisted histories are validated on restart.

Hosted histories live in the dashboard's durable metadata body. Publication,
source checks, append/prune, latest-version comparison and grant changes use
one metadata transaction. Dataset links cover every retained version, including
owner-pinned prepared bindings. The internal metadata row revision is distinct
from the published version; grant changes never consume a published version.

Versions start at 1 and strictly increase, including after pruning. Every
retained version has its own definition, name, typed bindings, owner identity
pin and publication provenance. No rendered rows, images or artifacts are
persisted. Analysis deletion atomically marks the republish link inactive while
leaving frozen versions, including their historical `SourceAnalysisId`, intact.
Recreating the analysis ID does not reconnect that old dashboard.

`OPENSIGHT_DASHBOARD_VERSION_CAP` optionally sets a positive keep-N cap.
Omitting it keeps every version. Append prunes the oldest non-latest versions
first. Explicit version deletion may prune a non-latest version with or without
a configured cap.

Retry keys bind tenant, namespace, user, method, path, payload and delete
precondition. Concurrent retries serialize before the resource operation.
Successful receipts are recorded after commit and before HTTP delivery.
Data-bearing replays also require the original security/data revision stamp;
changed revisions return 409 `DASHBOARD_REPLAY_REVISED`, so a still-permitted
query after a policy reduction cannot expose a previously broader result.
Replays recheck current identity, grants, folders and data admission; deleted
resources do not become replay bypasses. The existing process-local ten-minute
retry convention remains: it is not a distributed or restart-durable receipt
store. Receipt storage is bounded to 1,000 entries and 64 MiB of transient
export bytes; capacity returns 429 `IDEMPOTENCY_CAPACITY_EXCEEDED` with
`Retry-After`, rather than evicting a live key and duplicating a mutation.

## Controls, readers and embedding

Reader bodies contain values keyed by **frozen control ID**, never raw SQL,
columns, expressions, parameter declarations or ad-hoc predicates. Parameter
control values are validated against the declared scalar type/multiplicity.
Supported category filter controls replace the frozen filter's value list on
a request-local clone. Defaults use the frozen declarations. The shared
validator retains its hard errors for invalid structure, unresolved bindings
and denied access. Visual execution diagnostics are frozen with the version
under D-49; publication does not make an incomplete visual executable.

QuickSight parameter defaults now enter the same typed binding and expression
path as interactive queries; DuckDB and prepared/fixture execution share it.
The definition converter recognizes the supported parameter/filter control
variants so PascalCase descriptions preserve them correctly.

A dashboard grant allows definition access. Data queries and exports separately
resolve the **reader's own** data access. Under [D-85](idd/D-85-share-the-recipe.md)
(#155), hosted readers execute the publisher's prepared recipe with their own
source authorization. The recipe stays pinned to its publisher; a reader's
same-ID prepared dataset never substitutes for it. Each leaf source ID resolves
inside the reader's tenant, namespace and user scope, including nested recipes,
joins, append inputs and branches outside the selected output. Source row and
column policies apply before preparation and aggregation. Missing access or an
unexecutable recipe fails with `DASHBOARD_DATASET_ACCESS_DENIED` (403).

Reader execution recomputes the entire recipe in bounded request-local memory,
including root and nested Blaze recipes. It never reads or writes prepared
artifacts, and never opens publisher sources or secrets. Revisions are checked
through execution and before publication; revocation prevents stale/partial
results and cached query/export replays. Ordinary authentication still requires
a current session after policy changes. See [the implementation and security
proof](issue-155-reader-prepared-access.md). Owner execution is unchanged.
Source and dataset policies still intersect for legacy hosted bindings.

The existing local `POST /dashboards/{id}/embed-url` accepts optional `version`.
For published dashboards omission pins the latest version at issuance; the
signed token retains that selection through subsequent republishes. Pruned
versions fail closed. Session origin, signing and lifetime rules are unchanged.
Legacy imported dashboards retain their existing unversioned behavior; explicit
version selection requires a publication. Unversioned definition reads see the
latest published definition, and existing local visual-query/embed seams use
the same owner-pinned published bindings. Existing hosted embed/report paths
also reject prepared-to-legacy same-ID substitution and delegation of a
published dashboard's legacy bindings. Their prepared-version rendering and
anonymous published-dashboard integration remain deferred; they fail closed
with `EMBED_DATASET_UNSUPPORTED` / `JOB_DATASET_UNSUPPORTED` or
`DASHBOARD_ANONYMOUS_UNSUPPORTED` instead of using another data path.

## Export and SDK

Exports render the frozen version against currently authorized live data and
return `Content-Disposition: attachment`, a version ETag and `Cache-Control:
no-store`. CSV uses a rectangular `sheetId,visualId,row,column,value` layout
for heterogeneous visual tables, reusing the spreadsheet-safe CSV encoder.
PDF reuses the existing report compiler and ordered report tables. It is a
report-table export, not a claim of graphical chart or layout fidelity.

Operators install an open-source Chromium binary and set
`OPENSIGHT_PDF_CHROMIUM` to its executable path. No browser binary or new
external dependency is bundled. Without it PDF returns 503
`DASHBOARD_PDF_RENDERER_REQUIRED`. Rendering uses private debugging pipes,
blocks network requests, excludes operator credentials from the subprocess
environment, limits execution to 30 seconds, and kills the browser process
group and removes its temporary profile. Aggregate query input and artifact
sizes are bounded to 16 MiB; oversized exports return 413
`DASHBOARD_EXPORT_TOO_LARGE`. CSV requires no renderer configuration.

The headless SDK maps all twelve operations with typed request/result shapes,
quoted ETags, pagination, idempotency keys and mandatory delete preconditions.
`queryDashboardVisual` accepts only typed control values.
`createDashboardExport` returns bytes and content/ETag metadata; API failures
still use `OpenSightApiError` with named codes, diagnostics, status and 429
`retryAfter`. The OpenAPI coverage guard includes every dashboard operation.

## Verification and deferred work

Contract coverage lives in `packages/api/test/v1-dashboards.test.mjs` and runs
through root `npm test`. It covers both persistence planes, all twelve
operations, immutable reads, retention, latest-version concurrency, retries,
access-filtered pagination, user/group shares, cross-tenant and cross-owner
attempts, typed controls, revoked data policy, pinned embeds and transient
CSV/PDF output. PDF protocol tests use a local fixture; a real Chromium
render was also exercised. Shared engine tests compare parameter semantics
between DuckDB and the prepared evaluator.

The full root `npm test` rerun after the D-49 correction passed:
**2,720 passed / 0 failed / 18 skipped**.
All skips require live Postgres (`DATABASE_URL` is unset). The static demo
was rebuilt; all three captures are byte-identical to the analyses baseline,
with zero page errors or external requests. Per-suite counts and reference
comparisons are recorded in [gap notes](issue-95-dashboards-gap-notes.md).

Deferred by the brief: serverless `/api/v1` integration and durable distributed
rate/retry adapters (remote handoff; `serverless-application.ts` and Lambda
composition unchanged), anonymous/delegated data access, stored snapshots,
job-backed large exports, dashboard MCP tools. The assets decided core is implemented separately. No product decision
is required to use the implemented slice. Decision-document housekeeping is
deferred: D-49's recommendation and implications still describe the older
executable-only gate, and D-54 can record the brief's synchronous CSV/PDF
choices. The confirmed decisions are unchanged.

## Web editor integration (#151)

The hosted web editor now uses these routes to save analyses and publish
versioned dashboards. Hosted Home and My stuff list accessible publications;
the reader view queries their frozen visual definitions with live data and
supports authored parameter controls. Administrators can grant definition
access through the existing share route. D-53's independent dataset access
remains enforced through D-85's reader-authorized prepared execution. See
[the editor publication guide](issue-151-editor-publish.md) for recovery drafts,
retry behavior, reader limitations and visual verification.
