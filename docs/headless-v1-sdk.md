# Headless v1 TypeScript SDK (issue #95)

`packages/headless-sdk/` (`@opensight/headless-sdk`) is the generated-first
typed client for the headless v1 REST API (IDD D-37 decision 1: "REST+OpenAPI
first, MCP second, SDK/CLI generated (TS then Python)").

## Scope (frozen)

The SDK maps **1:1 onto `docs/api/openapi-v1.yaml` — the implemented
datasets + querying slices only.** It has methods for exactly these routes:

- `GET /datasets` → `listDatasets({ limit, cursor })`
- `GET /datasets/{id}` → `getDataset(id)`
- `PUT /datasets/{id}` → `saveDataset(id, body, { idempotencyKey })`
- `DELETE /datasets/{id}` → `deleteDataset(id, ifMatch)`
- `GET /datasets/{id}/lineage` → `getDatasetLineage(id)`
- `POST /datasets/{id}/query` → `queryDataset(id, query, { idempotencyKey })`
- `POST /datasets/{id}/refresh` → `refreshDataset(id, { idempotencyKey })`
- `GET /datasets/{id}/refresh-status` → `getRefreshStatus(id)`
- `GET /sources` → `listSources({ limit, cursor })`
- `GET /sources/{id}` → `getSource(id)`
- `DELETE /sources/{id}` → `deleteSource(id, ifMatch)`

There are intentionally **no** analyses/dashboards/assets/MCP methods — those
slices are contract proposals at review gates (D-39/D-40/D-41/D-42 drafts)
awaiting Tom's answers. `test/openapi-coverage.test.mjs` parses the OpenAPI
file and fails if any spec route is unmapped or any SDK entry invents a
route not in the spec, so new slices get caught by the test suite, not by
silence.

## Conventions

- Base URL is the API root (e.g. `https://host/api`); the client appends `/v1/...`.
- Auth: `getToken` returns the user-level, tenant-scoped bearer credential
  from the operator invitation path (D-37 decision 4); may be a string or an
  async function (refresh-token flows).
- Pagination via `Limit`/`Cursor` request **headers** (the hosted plane
  rejects query strings); results carry `nextCursor` (`null` at the end).
- `Idempotency-Key` on every mutation and query POST.
- `If-Match` (quoted integer version) required on deletes.
- Every non-2xx response throws `OpenSightApiError` with the named
  `errorCode`, the HTTP `status`, and `retryAfter` (from the `Retry-After`
  header) on 429 `RATE_LIMIT_EXCEEDED`.
- No raw SQL is ever sent: `queryDataset` takes the `InteractiveQuery`
  visual model (dimensions, measures, filters, parameter declarations and
  bindings), the same model the UI sends.

## Usage

```ts
import { OpenSightClient } from '@opensight/headless-sdk';

const client = new OpenSightClient({
  baseUrl: 'https://opensight.example/api',
  getToken: () => process.env.OPENSIGHT_TOKEN!,
});

const page = await client.listDatasets({ limit: 50 });
const result = await client.queryDataset('sales-2026', {
  dimensions: [{ fieldId: 'region', columnName: 'region' }],
  measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }],
  filters: [],
});
for (const row of result.rows) console.log(row);
```

## Boundaries

- Zero runtime dependencies (global `fetch` only); `typescript` dev-only.
- MIT/Apache-2.0 governs this code; no other dependency licenses.
- Not yet shipped: Python SDK and CLI generation (D-37 decision 1 lists TS
  first, Python second; both generate from the OpenAPI spec once the remaining
  slices freeze).
