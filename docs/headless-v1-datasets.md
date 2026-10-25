# Headless v1 — datasets slice (issue #95)

Shipped 2026-10-13. First resource-area slice of the frozen headless API
contract (`docs/api-contract-v1-draft.md`, IDD D-37). Machine-readable
contract: `docs/api/openapi-v1.yaml`.

## Endpoints (`/api/v1/...`, hosted tenant plane)

- `GET /datasets` — prepared-dataset list, paginated.
- `GET /datasets/{id}` — composed describe: schema columns, lineage
  pointers (sources/datasets/step count), refresh state.
- `GET /datasets/{id}/lineage` — full lineage: steps, resolved sources
  (connectorId/version, or `available: false` + errorCode), nested datasets
  with their own inputs, refresh state.
- `GET /datasets/{id}/refresh-status` and `POST /datasets/{id}/refresh` —
  refresh trigger is fail-closed: 409 `BLAZE_MODE_REQUIRED` on
  direct-query datasets.
- `PUT /datasets/{id}` / `DELETE /datasets/{id}` — prepared-dataset
  create/update/remove (thin versioned wrappers over the existing prep
  plane; delete needs `If-Match`).
- `GET /sources`, `GET /sources/{id}` — versioned source list and schema
  inspection.
- `DELETE /sources/{id}` — source retirement with the fail-closed
  pin-down: 409 `SOURCE_DELETE_BLOCKED_BY_DATASET` while any prepared
  dataset references the source, directly or through nested `{ dataset }`
  refs. Unreferenced sources retire exactly like the unversioned route.

## Conventions (all v1 routes)

- Bearer auth verified before the router; credential is user-level,
  tenant-scoped (D-37 decision 4). Operator plane (`/api/host/...`) is
  not part of v1.
- Named `errorCode` in every error body, plus a short message.
- Pagination: `Limit` / `Cursor` **request headers**, responses
  `{ items, nextCursor }`. The frozen `limit`/`cursor`/`nextCursor`
  convention rides headers because the hosted plane rejects query strings
  at the request boundary (`HOSTED_REQUEST_INVALID`).
- `Idempotency-Key` honored on every v1 mutation (10-minute single-node
  replay window; replays return the original response with
  `Idempotent-Replayed: true`). Durable upload/artifact writes keep using
  the durable dispatch machinery.
- Per-tenant rate limiting: 429 `RATE_LIMIT_EXCEEDED` + `Retry-After`
  (D-37 addendum; composes with HQ-14 `apiCalls` metering, which already
  counts these calls). Tunable via
  `OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE` (default 600).
- Optimistic concurrency on deletes via `If-Match: "<version>"`
  (428 `V1_IF_MATCH_REQUIRED` when missing).

## Retry receipt capacity

Dataset/query and analysis receipts share one process-local store, including
in local mode. These environment variables accept positive safe integers;
invalid values fail construction:

| Variable | Default |
| --- | --- |
| `OPENSIGHT_RETRY_CACHE_MAX_ENTRIES` | 1000 |
| `OPENSIGHT_RETRY_CACHE_MAX_BYTES` | 67108864 (64 MiB) |
| `OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_ENTRIES` | 250 |
| `OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_BYTES` | 16777216 (16 MiB) |

Bytes count the complete JSON-serialized receipt, including the response,
fingerprint/status, and analysis record/definition and access snapshot.
Map keys, bookkeeping and JavaScript object overhead are outside this JSON
byte measurement. Asset mutations (including resource DELETEs) and dashboard
receipts retain their separate caps.

New keyed executions reserve an entry before work starts. Exhausted entry
capacity or byte headroom returns 429 `IDEMPOTENCY_CAPACITY_EXCEEDED` with
`Retry-After: 60`. Exact receipt bytes are reserved before publication; analysis
receipts reserve them before saving or deleting. Dataset/query result sizes
are only known after execution: an oversized result returns the same capacity
error after execution has completed, and no receipt is retained. A dataset
mutation may therefore have taken effect; inspect its current version before
retrying. Failed work releases its reservation.

Unexpired receipts are never evicted to make room, and replay hits bypass
capacity admission while keeping existing authorization/publication checks.
The ten-minute expiry window is unchanged. Expired entries are pruned on
access and every 60 seconds by an unref'd timer, stopped on server shutdown.

## Deliberately not versioned here

Upload durability primitives (`/api/uploads`, reservations, operations)
stay unversioned — the contract draft names them against #91's protocol
work, which is held off pending Tom's territory answer. The v1 router
does not touch them.

## Tests

`packages/api/test/v1-datasets.test.mjs` — 5 contract tests: list/
pagination/describe/lineage/refresh-status, idempotency + If-Match on
dataset CRUD, source fail-closed deletion (direct and transitive refs),
rate limiting (429 + Retry-After, non-v1 routes unaffected), named error
codes on unknown routes/methods/ids.
