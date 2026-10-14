# Headless v1 — MCP slice (issue #95)

Status: **Approved for implementation** (D-42 and D-62–D-69 confirmed
2026-10-14). The historical proposal below is superseded by this alignment.

## Implementation alignment (2026-10-14)

- OpenAPI inventories **53 implemented operations**: datasets/querying/sources
  11, analyses 13, dashboards 12, and asset/folder/share additions 17.
  All now have unique snake_case operation IDs. The former deferred table is
  historical: D-39/D-40/D-41 shipped on master `4989fdc1`.
- Generation must use the OpenAPI operations, parameters and request schemas,
  not the old proposal tables. No REST wire changes accompany ID alignment.
- Share operations legitimately name a *target* `principalType`/`principalId`
  in their documented paths and permission bodies. Those are not caller
  identity assertions; the authenticated caller remains fixed by the token.
- Concurrency follows each operation's OpenAPI headers. In particular,
  dashboard share revocation has no If-Match in the shipped REST contract;
  MCP must not invent one. Required REST preconditions still return their
  named 428 errors when omitted.
- The dataset query keeps D-66's `query` wrapper; other request bodies use a
  `body` wrapper to preserve arbitrary definition fields without collisions
  with path/header inputs. Refresh's empty body is generated automatically.
  This replaces the proposal's flattened dataset-body example.
- JSON result bodies remain unchanged in structuredContent and text content;
  response headers (ETag, Idempotent-Replayed, Retry-After and export
  Content-Disposition) live in result `_meta`. Binary exports are represented
  losslessly as base64 with their media type; no new resources are advertised.
- The built-in hosted auth currently has no refresh exchange endpoint. The
  MCP client must not invent a REST route or substitute login credentials;
  an explicit operator OAuth exchange URL is required (no default route).
  See [ITD D-70](itd/D-70-mcp-runtime-boundaries.md) for the adapter wire
  format, missing hosted integration and audited runtime packaging.

Historical proposal (for the decision trail):
Prepared on `work/issue-95-mcp`, 2026-10-13. No MCP server, tool, or
transport has been implemented. Existing routes and the shipped
machine-readable contract in `docs/api/openapi-v1.yaml` remain unchanged.

The [frozen contract](api-contract-v1-draft.md#freeze-decisions-product-owner-2026-10-13)
answers all seven freeze questions, and IDDs
[D-37](idd/D-37-headless-first-api.md) and
[D-38](idd/D-38-dashboard-publish-semantics.md) are confirmed on the
branch's master base. The datasets and querying slices are implemented;
the analyses slice ([slice doc](headless-v1-analyses.md), draft
[D-39](idd/D-39-headless-analysis-authoring.md)), the dashboards slice
([slice doc](headless-v1-dashboards.md), draft
[D-40](idd/D-40-headless-dashboard-publishing.md)), and the assets slice
([slice doc](headless-v1-assets.md), draft
[D-41](idd/D-41-headless-asset-management.md)) are proposals awaiting
Tom's answers. [Draft IDD D-42](idd/D-42-headless-mcp-server.md) records
this slice's gate plus the further product questions below. Nothing
below is a frozen API commitment.

## What MCP is in this slice

MCP (Model Context Protocol) is the agent-native front door D-37
commits to as the second delivery shape, after REST+OpenAPI. A coding
agent calls tools like `list_datasets` and `run_dataset_query`
directly, instead of hand-building HTTP requests. Freeze Q7 settled
exactly one thing about MCP: **tool names are a mechanical 1:1 mapping
from the REST operations, not a second design.** Everything else —
transport, credential carriage, how header-carried conventions travel
in tool calls, how errors surface, which operations get tools now —
is proposed here and waits on review.

One principle governs the whole proposal: **the MCP server is just
another API client.** It calls the v1 HTTP API over the same routes
the UI will consume (D-37's "UI consumes the same API", extended to
agents). It never calls route handlers in-process, never reads the
metadata store directly, and never gets a privileged path. That is
what keeps the MCP surface honest: every tool an agent can call is a
REST operation that already exists, with the same auth, rate limiting,
and fail-closed checks.

## Existing behavior and implementation seams

- The implemented v1 surface is 11 operations in
  `docs/api/openapi-v1.yaml` (hosted tenant plane, `/api/v1/...`):
  `GET /datasets`, `GET /datasets/{id}`, `PUT /datasets/{id}`,
  `DELETE /datasets/{id}`, `POST /datasets/{id}/query`,
  `GET /datasets/{id}/lineage`, `POST /datasets/{id}/refresh`,
  `GET /datasets/{id}/refresh-status`, `GET /sources`,
  `GET /sources/{id}`, `DELETE /sources/{id}`. See the
  [datasets slice](headless-v1-datasets.md) and the
  [querying slice](headless-v1-querying.md) for semantics.
- Only **one** of the 11 operations has an `operationId`:
  `POST /datasets/{id}/query` → `runDatasetQuery` (camelCase). The
  other 10 have none. The three proposal slices (D-39/D-40/D-41) all
  propose snake_case `operationId` values, matching the D-37 examples
  (`create_dataset`, `run_query`, `add_visual`). The MCP
  implementation therefore needs a spec-only alignment first: add
  snake_case `operationId` values to all 11 implemented operations in
  `docs/api/openapi-v1.yaml`. That changes the machine-readable spec,
  not the REST wire behavior, and it is part of the MCP implementation
  step — not this proposal. The tool names below are the snake_case
  mapping of the resulting operationIds; where the one existing
  operationId is camelCase (`runDatasetQuery`), the tool name is its
  snake_case form (`run_dataset_query`).
- The v1 conventions every tool must preserve (from the datasets and
  querying slices): Bearer auth verified before routing, credential is
  user-level and tenant-scoped (D-37 decision 4); named `errorCode` in
  every error body; pagination via `Limit`/`Cursor` **request headers**
  with `{ items, nextCursor }` responses (headers, not query strings —
  the hosted plane rejects `?...`); `Idempotency-Key` honored on
  mutations (10-minute single-node replay window,
  `Idempotent-Replayed: true`); per-tenant rate limiting (429
  `RATE_LIMIT_EXCEEDED` + `Retry-After`, default 600/min via
  `OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE`, tenant-wide bucket shared by
  dataset/source/query calls); `If-Match` optimistic concurrency on
  deletes (428 `V1_IF_MATCH_REQUIRED` when missing).
- Querying constraints the query tool inherits exactly: no raw SQL
  through the API (SQL strings, envelopes, extra properties, and
  unrecognized operators fail with named errors); the body is the
  existing `InteractiveQuery` (dimensions, measures, filters,
  parameter declarations/bindings); results are `{ columns, rows }`
  with values matching their column's `string`/`number` type or
  `null`; query results are **not paginated** (`Limit`/`Cursor` do
  not slice query rows); queries are read-only POSTs, no `If-Match`;
  principal/policy assertions in the body are rejected with
  `FORGED_PRINCIPAL`; prepared datasets stay owner-private and
  protected source graphs are refused under existing prep rules.
- Datasets constraints the dataset/source tools inherit exactly:
  `PUT /datasets/{id}` is the versioned create/update wrapper over
  the prep plane; `DELETE /datasets/{id}` needs `If-Match`;
  `DELETE /sources/{id}` is fail-closed (409
  `SOURCE_DELETE_BLOCKED_BY_DATASET` while any prepared dataset
  references the source, directly or transitively); refresh is
  fail-closed (409 `BLAZE_MODE_REQUIRED` on direct-query datasets).
  Upload durability primitives (`/api/uploads`, reservations,
  operations) stay unversioned until #91's protocol work lands — no
  MCP tool touches them.
- No MCP code exists in the repo. There is no MCP server package, no
  MCP SDK dependency, and no MCP transport. The monorepo packages are
  `api`, `bundle-parser`, `embedding-sdk`, `o-interpreter`, `parity`,
  `query-engine`, `web`.

## Proposed tools (`/api/v1/...` mapped 1:1) — review required

All tool names below are proposals: the snake_case mechanical mapping
(freeze Q7) of the implemented v1 operations. No tool exists yet. Each
tool calls exactly one REST operation; no tool composes two REST
calls, retries on its own, or adds semantics the REST operation does
not have.

| Tool | REST operation | Proposed input / result |
| --- | --- | --- |
| `list_datasets` | `GET /datasets` | Input `{ limit?, cursor? }` (mapped to `Limit`/`Cursor` headers); result `{ items, nextCursor }` |
| `describe_dataset` | `GET /datasets/{id}` | Input `{ id }`; result is the composed describe (schema columns, lineage pointers, refresh state) |
| `update_dataset` | `PUT /datasets/{id}` | Input `{ id, idempotencyKey?, ...datasetBody }`; result is the REST operation's save summary `{ id, name, version, execution }` (not the full describe); create/update semantics are the REST operation's, unchanged |
| `delete_dataset` | `DELETE /datasets/{id}` | Input `{ id, ifMatch, idempotencyKey? }`; `ifMatch` required (428 without it); result `{ id, removed: true }` shape follows the REST operation |
| `run_dataset_query` | `POST /datasets/{id}/query` | Input `{ id, query: InteractiveQuery, idempotencyKey? }`; result `{ columns, rows }` (+ `execution` for BLAZE datasets); not paginated |
| `describe_dataset_lineage` | `GET /datasets/{id}/lineage` | Input `{ id }`; result is the full lineage (steps, resolved sources, nested datasets, refresh state) |
| `refresh_dataset` | `POST /datasets/{id}/refresh` | Input `{ id, idempotencyKey? }`; 409 `BLAZE_MODE_REQUIRED` on direct-query datasets |
| `get_dataset_refresh_status` | `GET /datasets/{id}/refresh-status` | Input `{ id }`; result is the refresh state |
| `list_sources` | `GET /sources` | Input `{ limit?, cursor? }` (mapped to `Limit`/`Cursor` headers); result `{ items, nextCursor }` |
| `describe_source` | `GET /sources/{id}` | Input `{ id }`; result is the source schema inspection |
| `delete_source` | `DELETE /sources/{id}` | Input `{ id, ifMatch, idempotencyKey? }`; `ifMatch` required; fail-closed 409 `SOURCE_DELETE_BLOCKED_BY_DATASET` while referenced |

Deliberately **not** proposed as v1 MCP tools:

- Any tool for an unversioned route (`/api/uploads`, `/api/o/query`,
  local `/api/assets`, folder/share/admin routes, embedding, AI-admin).
  MCP maps the versioned surface only. The generative `/api/o/query`
  path stays unversioned, so there is no `run_generative_query` tool.
- Any tool for the analyses, dashboards, or assets proposals (38
  operations — see below). Those tools land when D-39/D-40/D-41
  freeze, as mechanical mappings of the approved REST operations. No
  MCP tool is built ahead of its REST operation.
- Composite tools (`create_dataset_and_query`, `refresh_then_query`,
  …). Composition is the calling agent's job; the server exposes one
  tool per REST operation so the mapping stays mechanical and
  auditable.
- MCP prompts or MCP resources. Tools are the whole v1 MCP surface.
  A prompt ("build me a dashboard") or a resource ("the dataset as a
  document") would be new semantics, not a mapping — out of scope
  until a dedicated slice proposes them.
- A `search_assets`-style tool in this slice. Search belongs to the
  assets slice (D-41 Q1); its MCP tool follows the approved REST
  operation, not this proposal.

## Deferred tools (land when D-39/D-40/D-41 freeze)

| Source | Proposed REST operations | MCP tools when frozen |
| --- | --- | --- |
| Analyses (D-39 🚧) | 13: `list_analyses`, `describe_analysis`, `create_analysis`, `update_analysis`, `delete_analysis`, `add_visual`, `update_visual`, `remove_visual`, `set_layouts`, `add_filter_group`, `update_filter_group`, `remove_filter_group`, `set_calculated_fields` | 13 tools, same snake_case names |
| Dashboards (D-40 🚧) | 12: `publish_analysis`, `list_dashboards`, `describe_dashboard`, `list_dashboard_versions`, `describe_dashboard_version`, `delete_dashboard`, `delete_dashboard_version`, `get_dashboard_share`, `set_dashboard_share`, `delete_dashboard_share`, `query_dashboard_visual`, `create_dashboard_export` | 12 tools, same snake_case names |
| Assets (D-41 🚧) | 15: `list_assets`, `search_assets`, `move_asset`, `copy_asset`, `list_asset_shares`, `set_asset_share`, `delete_asset_share`, `list_folders`, `describe_folder`, `list_folder_assets`, `get_folder_permissions`, `set_folder_permissions`, `rename_folder`, `delete_folder`, `delete_asset` | 15 tools, same snake_case names |

Total deferred: **40 tools** (13 + 12 + 15). The counts above are
taken from the three proposal tables; if a proposal changes during
its review, its MCP tools follow the approved table, not this one.
The MCP implementation must not pre-build any deferred tool from a
proposal table — a proposal is not an approved operation.

## Product questions requiring answers

| Question | Proposed answer | What the decision changes |
| --- | --- | --- |
| Q1 — Transport: stdio, Streamable HTTP, or both? | **stdio first; Streamable HTTP later as its own slice.** The first MCP server is a local process speaking JSON-RPC over stdio: no new network listener, no CORS, no HTTP auth surface, and the credential lives in the process environment. HTTP transport (remote agents, shared servers) needs its own threat review — a listening endpoint with bearer auth, origin policy, and per-tenant rate limiting at the edge — so it is a follow-up, not part of this slice. | HTTP-first (or both now) adds a network service to review: listener binding, TLS, origin/CORS policy, and how the edge rate limiter composes with the v1 limiter. stdio-only keeps remote agents on the REST API until HTTP is reviewed. |
| Q2 — How does the MCP server get its credential? | **Server started with a refresh token from the operator invitation/minting path** (D-37 decision 4; frozen contract: secure refresh token, short-lived access, rotation, revocation). The token is supplied via environment/config at server start, never logged, never echoed in tool results, and never accepted as a per-tool parameter. The server exchanges it for short-lived access tokens and calls v1 as that user, in that tenant. No tool accepts a credential, principal, or policy assertion — those are rejected the way the REST layer rejects `FORGED_PRINCIPAL`. Revocation takes effect the same way it does for REST (the server holds no independent session). | Per-request Bearer (HTTP only) moves credential handling to every call and needs a caller-identity story. A server-wide service principal contradicts D-37's user-level credentials. Accepting credentials as tool inputs would let a prompt-injected agent exfiltrate or swap identities. |
| Q3 — Tool scope now vs later | **Tools only for implemented REST (the 11 above).** Analyses/dashboards/assets tools land when D-39/D-40/D-41 freeze. The MCP server never exposes a tool whose REST operation is still a proposal. | Building deferred tools now would freeze REST operations through the MCP side door — the exact silent-freeze failure the proposal-first slices exist to prevent. |
| Q4 — How do header-carried v1 conventions travel in tool calls? | **As ordinary tool input params, mapped to headers by the server.** `limit`/`cursor` → `Limit`/`Cursor` request headers; `idempotencyKey` → `Idempotency-Key` header; `ifMatch` → `If-Match` header. Responses surface `nextCursor` and `Idempotent-Replayed` in the tool result. The mapping is mechanical and documented per tool; the server adds no header the REST operation does not already define. | MCP-native pagination (cursor embedded in tool results, server-side cursors) would diverge from the REST contract and create a second pagination model. Leaving headers out entirely would lose idempotency and concurrency on tool calls. |
| Q5 — Query tool shape: how do `InteractiveQuery` schemas reach MCP? | **Tool input schemas are generated mechanically from the OpenAPI request schemas** (the same source SDK/CLI generation will use). `run_dataset_query` takes `{ id, query: InteractiveQuery, idempotencyKey? }` where `query` validates against the OpenAPI query schema — SQL strings, envelopes, extra properties, and unrecognized operators fail the same way REST rejects them. Result size follows the existing hosted execution budgets; the server invents no truncation or chunking (a result that exceeds budget fails with the REST error, not a silent partial). | Hand-written tool schemas drift from the OpenAPI spec and become a second contract. Invented truncation would silently return partial query results to agents. |
| Q6 — How do errors surface: MCP protocol errors or tool results? | **API errors are structured tool results, not protocol errors.** A v1 error (including 409s, 429s, 428s) returns a tool result with `isError: true` and a structured payload `{ errorCode, message }` — the same named code the REST operation returns, so agents can branch on `RATE_LIMIT_EXCEEDED`, `SOURCE_DELETE_BLOCKED_BY_DATASET`, `BLAZE_MODE_REQUIRED`, etc. Protocol/transport failures (bad JSON-RPC, unknown tool) are MCP protocol errors. Success results carry the REST response body unchanged. | Mapping every API error to a protocol error forces agents to parse error strings instead of branching on codes; it also hides the `Retry-After` on 429s. Returning errors as successful tool results would make failures invisible to agents that check only `isError`. |
| Q7 — Packaging: where does the MCP server live, and what does it depend on? | **A new standalone package (e.g. `packages/mcp-server`) that depends on the v1 HTTP API only** — it speaks HTTP to a configured v1 base URL, exactly like any other API client. For the MCP protocol itself, use the official TypeScript MCP SDK (MIT-licensed; license and version verified at implementation) rather than hand-rolled JSON-RPC — hand-rolled protocol code drifts from the spec and duplicates framing, batching, and error handling the SDK already covers. The package adds no server-side state: no cache, no session store beyond the short-lived access token, no persistence. | In-process reuse of route handlers would be faster but creates the privileged second path D-37 forbids. Hand-rolled JSON-RPC saves a dependency but owns protocol correctness forever. A stateful server (caching results, holding sessions) would need its own invalidation and tenant-isolation review. |
| Q8 — Discovery and versioning: how do agents learn the tools, and what does "v1" mean for MCP? | **`tools/list` enumerates exactly the implemented tools** (11 at first; grows as D-39/D-40/D-41 freeze). Tool descriptions quote the REST operation each tool maps to. The server reports its own version and the v1 API version it targets; a tool list never advertises a tool whose REST operation is unimplemented or still a proposal. Breaking changes to a tool (renamed input, changed result shape) require a version bump and migration notes, per D-37's stability rule. | Advertising proposed tools in `tools/list` would let agents call operations that do not exist. A server version decoupled from the API version would hide which REST contract the tools actually map to. |

## Conventions and validation to preserve after review

- Frozen contract on every tool call, inherited from the REST
  operation it maps to: named `errorCode` in all error payloads;
  pagination via `limit`/`cursor` params mapped to `Limit`/`Cursor`
  headers (`nextCursor` in results); `Idempotency-Key` on mutations;
  per-tenant rate limiting (429 `RATE_LIMIT_EXCEEDED` +
  `Retry-After`) — the MCP server must not bypass, cache-around, or
  batch through the limiter, and its own calls count in the same
  tenant bucket as direct REST calls (HQ-14 `apiCalls` metering
  counts them identically); `If-Match` where concurrency applies
  (Q4).
- Tenant boundary: every tool call runs as the server's single
  credentialed user in that user's tenant. No tool widens access:
  a dashboard/analysis grant never authorizes another owner's
  prepared data (HQ-4); `canRead`/`grantsAllow` filtering applies
  exactly as in REST; cross-tenant calls fail before I/O. The MCP
  server holds one identity — it is not a multi-tenant proxy and
  must not accept a per-call tenant/user override.
- No raw SQL, ever (D-37 decision 2): the only query tool takes
  `InteractiveQuery`; SQL text is rejected by the REST layer, and
  the MCP server adds no SQL path. SQL-looking filter values stay
  ordinary data.
- Definition bodies still cannot smuggle grants or placement:
  tools that will eventually take definitions (D-39) inherit the
  metadata rule; in this slice no tool takes a definition at all.
- Existing unversioned routes stay untouched. The MCP server is
  additive: it calls v1 over HTTP and changes nothing about the
  local routes, the UI, or the demo.
- The MCP server logs no credentials, no tokens, and no query
  results. Tool-call logging, if any, records tool name, tenant,
  duration, and error code — never request bodies or rows.

## Tests required after contract approval

- Tool inventory: `tools/list` returns exactly the 11 implemented
  tools (no more, no fewer), each with the input schema generated
  from the OpenAPI request schema and a description naming its REST
  operation. No deferred tool is advertised.
- Mapping: every tool calls exactly its REST operation (asserted
  against a stubbed v1 HTTP layer): path, method, headers
  (`Limit`/`Cursor`/`Idempotency-Key`/`If-Match`), and body pass
  through unchanged; `nextCursor` and `Idempotent-Replayed` surface
  in results.
- Auth: the server starts with a refresh token, exchanges it for
  short-lived access, and calls v1 as that user/tenant; a tool call
  carrying a credential/principal/policy param is rejected; revoked
  credentials fail closed; no credential appears in logs or results.
- Conventions: idempotency replay on mutation tools (same key =
  same result, no duplicate); `If-Match` required on delete tools
  (428 without); 429 `RATE_LIMIT_EXCEEDED` + `Retry-After` surfaces
  as a structured error result with the code intact; query-string
  rejection at the hosted boundary still holds behind the MCP
  server.
- Security: no raw SQL through `run_dataset_query` (SQL strings,
  envelopes, extra properties, unrecognized operators rejected);
  cross-owner and cross-tenant isolation (a tool call against
  another owner's prepared dataset fails the way REST fails);
  `FORGED_PRINCIPAL` on principal/policy assertions in tool inputs;
  no data-access widening through any tool (HQ-4).
- Regression: `npm test` stays green; OpenAPI
  `docs/api/openapi-v1.yaml` gains snake_case `operationId` values
  for the 11 implemented operations (spec alignment only) and no
  new REST endpoints; no new dependencies beyond the reviewed MCP
  SDK (MIT, license verified at implementation).

## Resume boundary

Approval must answer Q1–Q8 in the slice proposal, then the loop
records the approved contract, then implements and checkpoints the
MCP server package, the tool definitions, and the contract tests.
The proposal does not silently resolve D-39 Q1–Q5, D-40 Q1–Q7, or
D-41 Q1–Q7 — those stay owned by their slices; this slice maps
their approved operations mechanically when they freeze. The
deferred-tools table above is a snapshot of proposal tables, not an
approval of them.

## Baseline verification

Full root `npm test` exited 0 on 2026-10-13: **2,664 tests: 2,646 passed /
0 failed / 18 skipped / 0 cancelled** (per-suite counts in the gap
notes). Every skip explicitly requires live PostgreSQL (`DATABASE_URL`
is unset). These are the existing tests; this documents the baseline
at the review gate, not implemented MCP coverage.

The static demo rebuilds after publish via the demo shim (see the
[gap notes](issue-95-mcp-gap-notes.md)). This slice is docs-only, so
there is no UI delta to compare.
