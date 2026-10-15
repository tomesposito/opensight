# Headless v1 TypeScript SDK (issue #95)

`packages/headless-sdk/` (`@opensight/headless-sdk`) is the generated-first
typed client for the headless v1 REST API (IDD D-37 decision 1: "REST+OpenAPI
first, MCP second, SDK/CLI generated (TS then Python)").

## Scope (frozen)

The SDK maps **1:1 onto `docs/api/openapi-v1.yaml`** — all five implemented
slices: datasets, querying, analyses, dashboards, and assets/folders.
Method names mirror the TypeScript client's camelCase in Python
snake_case (`get_dataset`, `query_dataset`, `publish_analysis`,
`set_folder_permissions`, …). `test/test_openapi_coverage.py` parses the
OpenAPI file and fails if any spec route is unmapped or any SDK entry
invents a route not in the spec — the same anti-invention guard the TS
SDK carries.

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

## Python SDK (issue #95)

`packages/headless-sdk-python/` (`opensight-headless-sdk` on PyPI naming)
is the generated-first Python port of the TypeScript client (IDD D-37
decision 1: "TS then Python"). Same 1:1 mapping, same conventions, Python
idioms otherwise:

- Method names are snake_case: `list_datasets`, `get_dataset`,
  `query_dataset`, `publish_analysis`, `set_folder_permissions`, …
- `OpenSightClient(base_url, get_token, transport=None)` — `get_token`
  is a string or a zero-argument callable (refresh-token flows supply the
  current token); `transport` is an injectable
  `(method, url, headers, body_bytes) -> HttpResponse`, defaulting to
  stdlib `urllib`.
- `OpenSightApiError` carries `error_code`, `status`, `retry_after`,
  `body`. Versioned responses return a `VersionedResult(value, etag)`;
  `create_dashboard_export` returns `DashboardExportArtifact` with raw
  `bytes`.
- Wire shapes keep the API's casing (camelCase writes, PascalCase
  descriptions) as `TypedDict`s in `opensight_headless.types`.
- Zero runtime dependencies (`urllib` only); `pyproject.toml` declares
  `requires-python = ">=3.10"`. The `package.json` shim keeps the npm
  workspace green: its `test` script runs the unittest suite, skipping
  loudly if `python3` is unavailable.

```python
from opensight_headless import OpenSightClient

client = OpenSightClient(
    "https://opensight.example/api",
    get_token=lambda: current_token(),
)

page = client.list_datasets(limit=50)
result = client.query_dataset("sales-2026", {
    "dimensions": [{"fieldId": "region", "columnName": "region"}],
    "measures": [{"fieldId": "total", "columnName": "amount", "aggregation": "SUM"}],
    "filters": [],
})
for row in result["rows"]:
    print(row)
```

## Boundaries

- Zero runtime dependencies: the TS client uses the global `fetch` only
  (TypeScript dev-only); the Python client uses stdlib `urllib` only.
- MIT/Apache-2.0 governs this code; no other dependency licenses.
- Not yet shipped: CLI generation (D-37 decision 1). The CLI's user-facing
  shape (argument names, output formats) is product surface and has no
  confirmed decision yet — it ships as its own slice once specified.
