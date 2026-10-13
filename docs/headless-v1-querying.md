# Headless v1 — querying slice (issue #95)

Implemented on `work/issue-95-querying`, 2026-10-13. Second resource-area
slice of the frozen headless API contract (`docs/api-contract-v1-draft.md`,
IDD D-37). Machine-readable contract: `docs/api/openapi-v1.yaml`.

## Endpoints (`/api/v1/...`, hosted tenant plane)

- `POST /datasets/{id}/query` — query an owner-scoped prepared dataset
  through the same `HostedPrep.execute` / `HostedData.computeQuery` path
  as `POST /api/datasets/{id}/query`. Existing unversioned routes retain
  their request and response shapes.

The body is the existing `InteractiveQuery` from the web client:

```json
{
  "dimensions": [{ "fieldId": "region", "columnName": "region" }],
  "measures": [{ "fieldId": "total", "columnName": "amount", "aggregation": "SUM" }],
  "filters": [{ "columnName": "region", "parameterName": "Region" }],
  "parameterDeclarations": [{ "name": "Region", "type": "string", "multiple": false }],
  "parameterBindings": { "Region": ["east"] }
}
```

Dimension, measure and filter fields resolve against the dataset schema.
Supported aggregations are `SUM`, `AVG`, `COUNT`, `MIN` and `MAX`.
Filters accept a string `value`, string `values`, or a declared
`parameterName`. Parameter comparisons support equality and single
number/datetime ranges. Empty selections match no rows. Existing
calculated fields use the shared parsed QuickSight expression grammar.

No raw SQL is accepted: SQL strings, SQL envelopes, extra properties and
unrecognized operators fail with named errors. SQL-looking filter values
are ordinary data; they cannot become executable statements. Principal
and policy assertions in the body are rejected with `FORGED_PRINCIPAL`.

Successful direct queries return exactly:

```json
{
  "columns": [{ "name": "region", "type": "string" }, { "name": "total", "type": "number" }],
  "rows": [{ "region": "east", "total": 40 }]
}
```

Rows are objects keyed by the returned column names. Each value matches
its column's `string`/`number` type or is `null`. Empty results retain
their columns. A BLAZE dataset also returns
`"execution": { "mode": "BLAZE", "cached": true }`. This reports the
queried dataset's execution mode; it does not claim source freshness or
describe nested input caches. Hosted cache adapters do not expose a
shared refresh timestamp, so this slice does not invent one. A cold or
invalidated cache fails closed with the existing `BLAZE_NOT_READY` error.

## Conventions (all v1 routes)

- Bearer auth is verified before routing; credentials and results remain
  scoped to a user and tenant. Prepared datasets remain owner-private,
  and protected source graphs are refused under existing prep rules.
- Every error has an `errorCode`. Transport errors use
  `HOSTED_REQUEST_INVALID`; semantic query errors retain engine codes
  such as `UNRESOLVED_BINDING`, `UNSUPPORTED_FEATURE` and `TYPE_MISMATCH`.
  Located validation errors also include `path`.
- Query results are complete, bounded by existing hosted execution
  budgets, and **not paginated**. `Limit`/`Cursor` remain request headers
  for list endpoints; they do not slice query rows. Query strings are
  rejected at the hosted boundary.
- `Idempotency-Key` is honored on query POSTs using the existing
  ten-minute, single-node replay window and `Idempotent-Replayed: true`.
  Query replays are owner-scoped, repeat query validation and current
  graph admission, and are invalidated by metadata revision changes.
  Authorization and publication checks run before returning original
  results or replays. Without a key, each request executes the query.
- Per-tenant rate limiting returns 429 `RATE_LIMIT_EXCEEDED` with
  `Retry-After`. This slice corrects the shared v1 limiter to count all
  users of a tenant together. Dataset/source routes and query calls
  share the bucket; other tenants and unversioned routes are unaffected.
  `OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE` retains its default of 600.
  Existing budget/cache errors can also return 429; these retain their
  own codes and do not imply a rate-limiter `Retry-After` value.
- Queries are read-only POSTs; they do not need `If-Match`. The existing
  v1 mutation idempotency and delete concurrency conventions still apply.

## Deliberately not versioned here

`POST /analyses/{id}/visuals/{visualId}/query` in `sharing.ts` executes a
local `SalesQuery` fixture through `OrganizationService`. The hosted
tenant router has neither that fixture binding nor the local sharing
service. There is no clean hosted alias. The v1 visual query route is
therefore deferred until the analyses slice supplies the hosted analysis
binding and access model; this slice makes no new product decision.

The generative `POST /api/o/query` and upload/operation durability routes
remain unversioned. Unsupported `/api/v1/analyses/.../query` and
`/api/v1/o/query` requests return 404 `RESOURCE_NOT_FOUND`.

## Tests

`packages/api/test/v1-querying.test.mjs` — 10 HTTP contract tests, wired
into the API suite and root `npm test`: direct and cached result shapes,
unversioned compatibility, cold/stale cache refusal, SQL injection
rejection, parameter filters and calculated fields, null/empty results,
idempotency and policy rechecks, auth/method/body boundaries, cross-owner
and cross-tenant isolation, tenant-wide rate limiting, and authorization
revision immediately before result publication.

The datasets and querying suites share their real HTTP harness in
`packages/api/test/v1-helpers.mjs`.
