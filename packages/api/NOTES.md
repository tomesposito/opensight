# Local definition and live query API

Phase 3a adds [scheduled refresh, email reports and alerts](../../docs/scheduled-refresh-reports-alerts.md).
That document describes the new persistent automation resources, scheduler,
environment-only SMTP and run history; existing definition/query behavior remains.

Phase 2a adds [live parameters and controls](../../docs/parameters-controls.md).
That document supersedes the historical parameter/filter and offline Author
limitations below; the explorer and remote dataset boundaries are unchanged.

## Phase 1c: local sales queries

`POST /api/datasets/sales/query` executes DuckDB against the existing
`fixtures/renderable-sales/sales.csv` binding. This is an **OpenSight-local**
contract, not a QuickSight-compatible query API. There is **no authentication**;
use the loopback local development server. No AWS or PostgreSQL connections run.
Native DuckDB packaging for Lambda remains deferred.

```sh
curl http://127.0.0.1:3000/api/datasets/sales/query \
  -H 'Content-Type: application/json' \
  -d '{"dimensions":[{"fieldId":"region","columnName":"region"}],"measures":[{"fieldId":"revenue","columnName":"revenue","aggregation":"SUM"}],"filters":[]}'
```

The three arrays are required. Dimensions have `fieldId`, `columnName` and
optional `granularity`; measures additionally require `aggregation`; filters
have `columnName` and a string `value`. Unknown properties, invalid JSON/UTF-8,
wrong types, missing fields, or no measures return **400 `{Message}`**.
Bodies require `application/json` and are capped at **1 MiB** while reading,
including chunked bodies; exceeding the cap returns **413 `{Message}`**.

Supported semantics come from the engine: string dimensions, UTC `MONTH` date
dimensions, numeric `SUM`/`AVG`/`COUNT`/`MIN`/`MAX`, and ANDed string equality
filters applied before aggregation. There is no implicit East filter. Unsupported
semantics (including numeric dimensions, bad aggregation names, unknown columns,
or other date grains) return **422 `{errorCode, message, path}`**, preserving the
`QueryEngineError` diagnostic. The adapter supplies the engine's full
`PlanRequest` analysis/metadata envelope; callers cannot supply SQL, paths,
source metadata, or security declarations.

Success is **200 `{columns: [{name, type}], rows: [...]}`**. Rows are objects;
column types are `string` or `number`. Aliases are field IDs, except the engine's
MONTH dimension uses `month` (a `YYYY-MM` string). Columns remain available for
empty results, null aggregates remain null, and dimensions follow the engine's
ordering. The example returns East/500 and West/400.

Only ID `sales` is allowlisted. The configured `dataRoot` must contain the sales
fixture directory, be that directory, or select a file within it. At startup,
the API resolves only the fixed `local-data.json`, dataset/source response files
and regular `sales.csv`, requiring the existing sales ARN/table/file binding.
Absent or unresolved bindings and other IDs return **404 `{Message}`**. There is
no fallback to a different root. Metadata is loaded at startup; execution reads
the CSV per query and retains the engine's metadata/security and real-path checks.
Other methods return **405** with `Allow: POST`; invalid IDs/URL selectors return
400. Unexpected failures return 500 without stack traces. Responses use JSON and
`Cache-Control: no-store`.

Phase 1c validation (Node 24.20.0 / npm 10.9.4): final root `npm test` exited 0,
with API **26/26**, bundle parser **134/134**, query engine **131/131**, and web
**139/139** passing (**430 total; 0 failed, skipped, cancelled or todo**).
Strict builds and public consumer checks passed. The eight new API tests cover
CSV-derived aggregation values/nulls, filters/months/multiple dimensions, KPI,
404/400/422 responses, routing, and both fixed-length and chunked size limits.
Root build and the single-file demo build passed; see the web notes for browser
checks. An initial sandboxed run had 408 passes and 22 loopback `listen EPERM`
failures; the successful final suite ran with local socket access. No AWS calls.

## Scope and evidence

This user-requested Phase 0 slice implements the two local read paths from
[D2 and §3.2](../../SOLUTION_DESIGN.md), using the checked-in
[API catalog](../../docs/research/api-surface.md). The explicit task authorizes
building this local slice before the design's SDK/model pin and captured-service
contract gate. That gate remains open: these are provisional, docs-shaped local
responses, not certified AWS wire/SDK compatibility. No AWS calls, SDK dependency,
model pin, authentication, or service-response captures are introduced.
`SOLUTION_DESIGN.md` is unchanged.

## Runtime and use

- TypeScript with `strict` and `noUncheckedIndexedAccess`, ESM, Node >=24.
- Plain `node:http`, without a framework or HTTP runtime dependency.
  Runtime dependencies are the workspace `@opensight/bundle-parser` and
  `@opensight/query-engine` packages.
- Public `createApiServer({ dataRoot })` loads the data and returns an **unbound**
  `node:http` server. Callers control host, port, and shutdown. Importing the package
  starts no listener. HTTP tests use actual loopback sockets and Node's `fetch`.
- CLI configuration: `OPENSIGHT_DATA_ROOT` selects a directory or one `.qs`/`.json`
  file; default is the repository's `fixtures/`, resolved relative to the module.
  `HOST` defaults to `127.0.0.1`; `PORT` defaults to `3000` (0 selects a free port).
  Invalid ports and data fail startup with a nonzero exit. SIGINT/SIGTERM close the
  listener and connections. This is a local development server without auth.

From the repository root:

```sh
npm install
npm run build --workspace=@opensight/api
npm start --workspace=@opensight/api

# Use only the real bundle:
OPENSIGHT_DATA_ROOT="$PWD/fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs" npm start --workspace=@opensight/api

curl http://127.0.0.1:3000/analyses/renderable-sales/definition
curl http://127.0.0.1:3000/analyses/2f99f271-1f84-4a57-9843-31646734d5c9/definition
curl http://127.0.0.1:3000/dashboards/e0772d4e-bd69-444e-a421-cb3f165dbad8/definition
```

The renderable-sales route requires the default fixture root (or that fixture's
directory/file), not the single real bundle in the optional command above.

## Disk sources and validation

- At startup, recursively scan the configured directory in sorted order for `.qs`
  and `.json` files. IDs come from document contents, never filenames. Restart to
  reload definition changes; definition routes have no request-time filesystem
  access or watcher. Dataset/source definitions are not served. The query route
  separately reads its resolved CSV and executes DuckDB as described above.
- `.qs` uses `loadQsBundle`, including its ZIP limits, CRC/path/ID validation and
  unknown-property preservation. Standalone lowercase analysis/dashboard archive
  members use `parseBundleResource` and the same API adapter.
- PascalCase JSON accepts a definition response (`AnalysisId` or `DashboardId`,
  plus `Definition`) or the existing synthetic fixture envelope. Exactly one ID
  must be present. Optional synthetic `ResourceType` must agree with the ID.
  Require a definition object and `DataSetIdentifierDeclarations` array with string
  `Identifier`/`DataSetArn` members. The remaining graph stays opaque; using the
  synthetic parser would incorrectly restrict API/unknown features to its inventory.
  This is envelope validation, not a full QuickSight schema validator. Internally
  opaque values stay `unknown`; they are not asserted to satisfy the entire
  `QuickSightApi` namespace merely because they loaded successfully.
- Unrelated valid JSON in a directory (summaries, dataset/source responses, local
  bindings, query oracles) is ignored. An explicitly selected JSON file must be a
  definition. Invalid JSON/UTF-8, invalid recognized definitions, corrupt archives,
  and duplicate `(kind, ID)` pairs fail the complete load before listening, with
  source context. There is no partial index or silent precedence. Analysis and
  dashboard IDs have independent namespaces. Empty directories are allowed.
- JSON files have a 16 MiB limit checked before and during reading. ZIP budgets
  remain the parser's. Hidden entries and `node_modules` are skipped. Discovered
  symlinks are skipped and an explicitly selected symlink is rejected. The data
  root is trusted administrator configuration; this is not an untrusted upload
  service or an aggregate memory-budget implementation.

## Response adaptation and preservation

| Route | Response body |
|---|---|
| `GET /analyses/{id}/definition` | `AnalysisId`, `Definition`, supplied optional/extension fields, fresh `RequestId` |
| `GET /dashboards/{id}/definition` | `DashboardId`, `Definition` (dashboard version definition), supplied optional/extension fields including `DashboardPublishOptions`, fresh `RequestId` |

- Success is HTTP 200 with JSON and `Cache-Control: no-store`. `Status` belongs to
  the HTTP transport, `$metadata` to an SDK, and `ResourceType`/`resourceType` to
  fixture/archive envelopes; these are not emitted as response body markers.
  A source `RequestId` is replaced with a fresh UUID for each HTTP request.
  Other optional response fields, including `Errors`, `ResourceStatus`, `Name`
  and `ThemeArn`, are retained when provided. No success status, empty errors,
  theme, or other optional property is fabricated when absent.
- PascalCase definition JSON passes through structurally, including all unsupported
  visual/filter/parameter variants and unknown properties. No feature execution
  support follows from serving a definition.
- The archive adapter has **explicit, context-specific rules** for the real sample:
  IDs/name, dataset declarations, sheets, pie fields/wells, observed pie appearance,
  tooltip/sort settings, grid layout/canvas, defaults/options/query options, and
  observed dashboard publication settings. It preserves values, IDs, array order,
  absent properties and map keys. It does not recursively capitalize arbitrary JSON.
  Casing exceptions include `qbusinessInsightsStatus` → `QBusinessInsightsStatus`,
  `exportToCSVOption` → `ExportToCSVOption`, `dataQAEnabledOption` →
  `DataQAEnabledOption`, and the documented **lowercase** `highlightOperation` API
  member with `Trigger` inside it.
- Unknown archive properties/subtrees are retained verbatim at their original
  location. This includes archive-only `validationStrategy` and `linkEntities`
  as opaque extensions to avoid losing supplied information. Arrays whose item
  schemas are unobserved (calculations, parameters, filters, actions, hierarchies)
  get the known container name but their contents remain untouched. An unobserved
  visual variant remains in its original casing. These opaque extensions are
  preserved, not claimed to be API-translated or executable.
- A source containing both mapped and destination keys (e.g. `name` and `Name`)
  fails startup instead of overwriting either value. Literal `__proto__` properties
  remain ordinary JSON data. Archive inputs are never mutated or rewritten.

## HTTP boundary

- Definition routes support GET only. Decode the ID once, then
  require `[A-Za-z0-9_-]{1,512}`. This is a local routing rule. IDs index a `Map`;
  they never construct file paths. Invalid percent encoding, separators, control
  characters and overlong IDs return 400. Valid encoded IDs resolve normally.
- Unknown resources/routes return 404. Other methods on a definition route return
  405 with `Allow: GET`; HEAD has no response body. No implicit metadata or AWS
  account-prefixed routes, persistence routes, CORS, health route, or list API is added.
- Nonempty query strings return 400, including dashboard version/alias selectors.
  Returning a default definition for an unsupported selector would be misleading.
- Errors use local `{ Type, Message, RequestId }` bodies: 400
  `InvalidParameterValueException`, 404 `ResourceNotFoundException`, 405
  `MethodNotAllowed`, and 500 `InternalFailureException` if response serialization
  fails (for example, JSON nested beyond Node's serialization stack limit).
  These bodies/405 behavior are explicit OpenSight choices;
  the catalog has not established AWS exception wire bodies or headers. Resource
  definition `Errors` remain separate from operation failures. HTTP errors expose
  no disk paths or stack traces; startup diagnostics identify bad source files.

## Tests and build integration

`npm test` already runs all `packages/*` workspace test scripts, so the new package
joins the root suite without changing root scripts. The API build explicitly builds
its parser and query-engine dependencies first, making both a clean workspace build and an isolated
API test run independent of workspace enumeration order. Tests also compile a
strict TypeScript consumer through the public package export.

```sh
npm test --workspace=@opensight/api
npm test
```

The checked-in `test/fixtures/real-*.response.json` files are local expectations
derived from the sanitized bundle and catalog spelling, **not captured AWS
responses**. They include every observed analysis/dashboard field, apart from the
archive marker, and omit the generated request ID. HTTP tests compare complete
bodies with these static expectations and separately exercise casing exceptions,
the existing renderable fixture, native optional fields, deep opaque/map-key
preservation, future variants, both source formats, startup snapshots, source
failures/collisions, resource isolation, and HTTP errors. No AWS calls are made.

Validation on 2026-09-26 with Node v24.20.0 / npm 10.9.4:

| Root `npm test` workspace | Tests | Passed | Failed | Skipped / cancelled / todo |
|---|---:|---:|---:|---:|
| `@opensight/api` | 18 | 18 | 0 | 0 / 0 / 0 |
| `@opensight/bundle-parser` | 134 | 134 | 0 | 0 / 0 / 0 |
| `@opensight/query-engine` | 131 | 131 | 0 | 0 / 0 / 0 |
| Total | 283 | 283 | 0 | 0 / 0 / 0 |

Root `npm test` exited 0, including all strict package builds and public TypeScript
consumer checks. A CLI smoke test started the built CLI from `/tmp` with an explicit
renderable-sales data root, `HOST=127.0.0.1` and `PORT=0`: the analysis returned 200,
an excluded dashboard returned 404, and SIGTERM shutdown exited 0. `PORT=invalid`
correctly exited 1 with the port-validation diagnostic. `git diff --check` passed.

The initial sandboxed API run compiled successfully but could not bind loopback
sockets (`listen EPERM`): 4 startup tests passed and 13 HTTP tests failed for that
environmental reason. The complete successful root run above used loopback access
and includes the subsequently added serialization-error test. Dependency downloads
also required network access; installation was confined to this worktree with the
npm cache under `/tmp`. Neither run made AWS calls.
