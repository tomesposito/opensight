# Headless v1 — dashboards slice (issue #95)

Status: **🚧 Contract proposal; implementation blocked on product review.**
Prepared on `work/issue-95-dashboards`, 2026-10-13. No dashboard endpoints
have been added to v1. Existing routes and the shipped machine-readable
contract in `docs/api/openapi-v1.yaml` remain unchanged.

The [frozen contract](api-contract-v1-draft.md#freeze-decisions-product-owner-2026-10-13)
answers all seven freeze questions, and IDDs [D-37](idd/D-37-headless-first-api.md)
and [D-38](idd/D-38-dashboard-publish-semantics.md) are confirmed on the
branch's master base. D-38 settles what publish *means* (immutable
versioned definition, live data, readers limited to built-in
filters/controls, definition-only versions, keep-every-version default,
operator cap allowed) and explicitly carries **who-can-publish** to this
slice. [Draft IDD D-40](idd/D-40-headless-dashboard-publishing.md) records
that gate plus the further product questions below. Nothing below is a
frozen API commitment.

## Existing behavior and implementation seams

- Local `GET /dashboards` and `GET /dashboards/{id}/definition` live in
  `packages/api/src/index.ts`. The definition response uses the existing
  PascalCase QuickSight envelope, is GET-only, and rejects query strings.
  There is no publish endpoint, no version concept, and no version storage.
  `DefinitionStore` (`packages/api/src/store.ts`) is a startup snapshot
  reader: `load`, `list`, `get` only — no save, no versions.
- Share grants live in `packages/api/src/sharing.ts`:
  `GET|PUT|DELETE /dashboards/{id}/shares(/user/{userId}|/group/{groupId})`.
  They are **admin-only** and grant access to the *definition*, never to
  the sharer's data-policy context (the file's own doc comment). There is
  no reader role, no publish grant, and no data-access widening through
  shares today.
- The UI's PUBLISH is an honest stub
  (`packages/web/src/AuthorToolbar.tsx`, `publishNotice`): "Publishing
  needs a hosted deployment with dashboard publication enabled. It is
  not available in this editor yet; nothing has been published." The File
  menu Publish item runs the same stub. Today there is no durable
  difference between a dashboard's working state and its published state.
- Embed URLs (`packages/api/src/embedding.ts`,
  `POST /dashboards/{id}/embed-url`) issue against the dashboard's
  **current** definition via `organization.requireRead` — the live draft
  equivalent, not a published version. There is no version parameter.
  Under D-38, embeds should resolve to a published version; that mapping
  is part of the review (Q4), not an assumed behavior.
- Report/snapshot machinery exists (`packages/api/src/reports.ts`:
  `DashboardSnapshots.capture`, `assembleReport`, `ReportService`
  subscriptions) but there is **no dashboard-scoped snapshot/export
  endpoint**. D-38 rules out stored rendered snapshots ("definition
  only — never rendered snapshots"), so the slice reconciles #95's
  "snapshot/export" bullet as **render-on-demand**: render a frozen
  definition against live data into a transient artifact, never a
  stored snapshot. The delivery model is a review question (Q7).
- Asset move/copy exists at
  `/api/assets/(analysis|dashboard)/{id}/(move|copy)`
  (`packages/api/src/organization.ts`). Move belongs to the **assets
  slice**, not this one; copy creates a new asset, not a version.
- The analyses slice ([slice doc](headless-v1-analyses.md), draft
  [D-39](idd/D-39-headless-analysis-authoring.md)) is still 🚧 — its Q1–Q5
  are unanswered. Publish takes an analysis as input, so the dashboards
  contract depends on the analyses contract in two places: what counts
  as a publishable ("clean") analysis (Q2), and what happens to
  published dashboards when the source analysis is deleted (Q5). The
  analyses doc's working assumption — deletes preserve already-published
  dashboard definitions per D-38 — is owned by Q5 here, not settled there.

## Proposed endpoints (`/api/v1/...`) — review required

The recommendation is: publish is addressed under the source analysis;
versions are addressed under the dashboard. All names and paths below
are proposals, including the `operationId` values that would map
mechanically to MCP tools (freeze Q7).

| Method and path | Proposed operationId | Proposed body / result |
| --- | --- | --- |
| `POST /analyses/{id}/publish` | `publish_analysis` | Body `{ dashboardId? }` (omit to create a new dashboard, server-minted id; supply to append a version to an existing dashboard for the same source analysis, else 409). 201 with `{ DashboardId, Version, PublishedAt }` + `ETag` |
| `GET /dashboards` | `list_dashboards` | Paginated published dashboards, latest-version summaries |
| `GET /dashboards/{id}` | `describe_dashboard` | Latest published version: existing PascalCase envelope + `Version`, `PublishedAt`, `SourceAnalysisId`; version in `ETag` |
| `GET /dashboards/{id}/versions` | `list_dashboard_versions` | Paginated `{ version, publishedAt, publishedBy }` |
| `GET /dashboards/{id}/versions/{version}` | `describe_dashboard_version` | One frozen definition + `ETag` |
| `DELETE /dashboards/{id}` | `delete_dashboard` | Removes the dashboard and all its versions; requires `If-Match` on the latest version (Q5) |
| `DELETE /dashboards/{id}/versions/{version}` | `delete_dashboard_version` | Prune one version under the retention cap (Q5); never the latest version — deleting the latest requires deleting the dashboard |
| `GET\|PUT\|DELETE /dashboards/{id}/shares(/user/{userId}\|/group/{groupId})` | `get_dashboard_share` / `set_dashboard_share` / `delete_dashboard_share` | Versioned form of the existing unversioned share-grant shape (Q6) |
| `POST /dashboards/{id}/versions/{version}/visuals/{visualId}/query` | `query_dashboard_visual` | Run one visual of a frozen version against live data; body carries values **only** for controls declared in that version — anything else is rejected (Q4) |
| `POST /dashboards/{id}/exports` | `create_dashboard_export` | Render-on-demand export of a version: `{ version?, format }`; delivery model per Q7 |

Describe responses reuse the existing PascalCase QuickSight envelope
plus the new `Version` / `PublishedAt` / `SourceAnalysisId` fields.
Publish takes an (optional) `dashboardId` and no other body, so no new
wire-casing question arises here — unlike the analyses slice, there is
no camelCase-write / PascalCase-read asymmetry to review.

Version numbers are integers starting at 1, monotonically increasing
per dashboard. The `ETag` is the quoted integer version, matching the
`If-Match` pattern the analyses proposal recommends. A publish never
rewrites an existing version: editing the analysis and republishing
appends a new version, and every previously published version keeps
returning exactly the definition it froze.

## Product questions requiring answers

| Question | Recommendation for review | Alternative / consequence |
| --- | --- | --- |
| Q1 — Who can publish? | Build capability + co-owner access on the source analysis, mirroring the D-39 Q2 proposal (itself unapproved — see dependency note). Grants/placement cannot be overwritten through publish | Administrator-only publish, or a separate publish grant, changes who can ship dashboards and needs its own access model |
| Q2 — Must the analysis be clean? | Publish requires a valid, executable analysis; failures return validation diagnostics and publish nothing. "Valid" reuses whatever validation the approved analyses contract defines — this slice does not invent a second validator | Permit publishing drafts with diagnostics (readers see partial/broken visuals), or require a stricter clean state (e.g. no warnings). Changes whether agents can publish incrementally |
| Q3 — Dashboard identity | Publish creates a dashboard with its own id, linked to the source via `SourceAnalysisId`. One analysis can publish to many dashboards (per-audience variants); `dashboardId` in the publish body appends to an existing dashboard only when its source matches, else 409 | Dashboard id equals the analysis id (1:1). Simpler addressing, but no per-audience variants and a confusing shared id across two asset kinds |
| Q4 — Version addressing and defaults | Reads default to the **latest published version**, never the working draft. Embed URLs accept an optional version (default latest published); the unversioned `GET /dashboards/{id}/definition` keeps returning the dashboard asset's stored definition, which after publish is the latest published version. Reader queries run one visual of one frozen version with only declared control values; ad-hoc filters are rejected with a named `errorCode` | Default-to-draft reads, or version-pinned-only reads, change what shared links and embeds resolve to; allowing reader-supplied ad-hoc filters would break D-38's "readers limited to built-in filters/controls" |
| Q5 — Lifecycle: unpublish, delete, retention | No separate unpublish verb in v1: deleting a dashboard removes it and all versions. Per-version delete prunes under the operator cap but never the latest version. Deleting the source analysis preserves already-published dashboards (they are independent frozen definitions) and severs the republish link; republishing a deleted analysis fails closed. Retention: keep every version by default per D-38; the operator cap prunes oldest non-latest versions first | A distinct unpublish (hide without deleting), deleting dashboards with their source analysis, or a keep-N default each change the audit story and the storage bill |
| Q6 — Who can read / share a published dashboard? | Readers see a published dashboard's definition and data **only where they independently have access to the underlying datasets** — a dashboard grant never authorizes another owner's prepared data (HQ-4, and the sharing.ts definition-only rule). Share grants stay admin-managed until a reader-access model is decided; anonymous-embed access follows HQ-6 and requires its own decision | A published dashboard carrying the publisher's data authorization (delegation) would let readers see data they cannot otherwise access — it contradicts HQ-4's owner-only pilot and must not be assumed. A reader role with its own grant model is a larger design, not a default |
| Q7 — Export shape | Render-on-demand from a frozen version against live data (never a stored rendered snapshot, per D-38). Proposed: `POST /dashboards/{id}/exports` with `{ version?, format }`; formats and delivery (synchronous artifact vs. job-backed with polling, reusing the durable-jobs machinery) to be decided — the existing report machinery covers email HTML; PDF/CSV shapes are not assumed | A stored-snapshot export contradicts D-38. A synchronous-only export caps artifact size; a job-only export complicates the simple case |

Q1 depends on D-39 Q2 (who can create/edit analyses), which is still
🚧. If D-39 lands a different access model, Q1 must be re-derived from
it rather than shipping the mirrored proposal. Q2 depends on the
analyses validation semantics for the same reason. Q6 does not propose
changing HQ-4. Shared dashboard visibility and access to its underlying
prepared data are separate: a dashboard grant never authorizes another
owner's prepared dataset, and the review must settle the experience
when a permitted reader cannot access the dashboard's data sources.

## Conventions and validation to preserve after review

- Extend `V1Routes`; keep unversioned paths working. Use `Limit`/`Cursor`
  request headers, `{ items, nextCursor }` lists, named `errorCode`
  failures, per-tenant 429 `RATE_LIMIT_EXCEEDED` with `Retry-After`, and
  current authorization checks before returning definitions or replays.
- Honor `Idempotency-Key` on every mutation using the established replay
  convention. A retried publish with the same key returns the original
  version, never a duplicate version. Replay cannot bypass current
  access or silently accept a different payload.
- Publish validates the source analysis through the **approved**
  analyses validation path, not a second validator. A publish that
  fails validation publishes nothing and returns named diagnostics.
- Reader queries validate control values against the frozen version's
  declared controls/parameters only; undeclared filters, raw SQL, SQL
  envelopes, and forged principal fields are rejected by construction.
  QuickSight expression strings remain input to the allowlisted parser
  only.
- Published versions are immutable: no mutation path may rewrite one,
  and no analysis edit may change one. Local durable writes need an
  atomic persistence implementation, restart recovery, and the existing
  maintenance fence; mutating the startup map is not persistence. Local
  files and hosted metadata must implement the same approved
  mutation/validation semantics without paths derived from untrusted IDs.
  No new dependencies are planned.

## Tests required after contract approval

`packages/api/test/v1-dashboards.test.mjs` should use the existing
`serving` harness plus a local-server harness and run through the API/root
suites. No dashboard contract tests or implementation are claimed by this
proposal. The build must cover:

- Publish round trips on both planes; version numbering, `ETag` /
  `If-Match` behavior, and immutability (edit + republish leaves earlier
  versions byte-identical); idempotent republish with the same key
  returns the original version, never a duplicate.
- List/describe pagination after access filtering; version listing;
  latest-vs-pinned reads; embed-version resolution per Q4.
- Role/grant checks on publish, share, delete, and version delete;
  cross-tenant/cross-owner/forged-principal bypass attempts; revocation
  immediately before publish/read/replay.
- Clean-state rejection with named diagnostics; publish of an analysis
  with denied/unresolved bindings fails closed; publish of a deleted
  analysis fails closed.
- Reader queries: declared control values accepted; ad-hoc filters,
  undeclared parameters, and SQL attempts rejected with named error
  codes; readers without dataset access get no data (Q6).
- Delete semantics per Q5: dashboard delete removes all versions;
  version delete never removes the latest; source-analysis delete
  preserves published dashboards and severs the republish link.
- Export: render-on-demand output matches the frozen definition
  against live data; no stored rendered snapshot is created; format
  and delivery behavior per Q7.
- Tenant-wide rate limits on every route; local restart persistence
  of versions and grants.

## Resume boundary

The current checkpoint is contract discovery and a reviewable proposal.
No proposed mutation has been implemented or published in OpenAPI. After
product answers Q1–Q7, record the approved contract, then implement and
checkpoint the routes, version storage, validation, and contract tests.
The assets slice (search, move, permission verbs) and the MCP mapping
(mechanical 1:1 per freeze Q7) remain separate slices; this proposal
does not silently resolve them.

## Baseline verification

Full root `npm test` exited 0 on 2026-10-13: **2,646 passed / 0 failed /
18 skipped / 0 cancelled**. Every skip explicitly requires live PostgreSQL
(`DATABASE_URL` is unset). These are the existing tests; this documents
the baseline at the review gate, not implemented dashboard API coverage.

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

Runtime sources, dependency manifests, `SOLUTION_DESIGN.md` and the
shipped OpenAPI contract match the master base; proposal links resolve
locally. Nothing has been merged or pushed.
