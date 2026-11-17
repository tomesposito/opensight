# Athena query connector — issue #272

Athena is an implemented **library query connector**, using the Apache-2.0
AWS SDK for JavaScript v3 (`@aws-sdk/client-athena` **3.1149.0**). Its installed
`package.json` and `LICENSE` were checked before wiring it into the server export.
This matches the other AWS clients already used by the API. Installation also
applied the existing root `tslib` 2.8.1 override, deduplicating older nested copies;
that 0BSD helper is covered by the existing D-27 exception. No other dependency
or license exception was introduced.

`executeAthena(request, options)` and
`executeConnector('athena', config, request, environment)` plan a visual using
the dedicated Athena dialect, then execute it through the SDK. The executor is
exported from `@opensight/query-engine`, **not** its browser entry. This is not a
raw SQL endpoint or an automatic translator for PostgreSQL/DuckDB SQL.

## Configuration

Stored configuration contains only environment variable **names**:

| Field | Required | Resolved server value |
| --- | --- | --- |
| `regionEnv` | Yes | AWS region |
| `databaseEnv` | Yes | Athena database, matching the physical table's declared schema |
| `workGroupEnv` | No | Athena workgroup; omitted from the SDK request when not configured |
| `outputLocationEnv` | Yes | Query-result S3 output location |

For example, a stored configuration can name `ATHENA_REGION`, `ATHENA_DATABASE`,
`ATHENA_WORKGROUP` and `ATHENA_OUTPUT`. Values are supplied by the server operator.
There is no credentials field: `AthenaClient` receives only `{ region }` and uses
its default server-side credential chain. The optional `environment` injection
resolves connection settings; it does not override SDK credentials. No imported
source metadata can provide credentials, select a connection or override its
workgroup. Descriptive `Type: 'ATHENA'` metadata accepts `AthenaParameters` with
an optional `WorkGroup`; database selection comes from the physical schema and
must match the trusted configured database.

Unknown fields, raw credentials/addresses in stored configuration and database
mismatches fail with `INVALID_CONNECTOR_CONFIG`. Missing or invalid environment
values fail with `CONNECTOR_NOT_CONFIGURED`. Security, SQL planning and config
checks all finish before client construction or I/O.

## Execution and cancellation

1. `StartQueryExecution` receives the generated Athena SQL, positional execution
   parameters when present, database, optional workgroup and output location.
   Numbered internal binds become `?` in SQL occurrence order, including repeats;
   quoted SQL literals and identifiers remain intact. Values are stringified
   without rewriting strings or UTC datetime values. Null execution parameters
   fail closed with a named error; public parameter validation can reject them
   earlier as `INVALID_INPUT`.
2. `GetQueryExecution` polls queued/running queries with 100, 200, 400, 800, then
   at most 1,000 ms between requests. Requeued queries remain within the same
   deadline. `FAILED`, `CANCELLED`, missing and unknown states fail closed.
3. After `SUCCEEDED`, `GetQueryResults` requests at most 1,000 rows per page and
   follows `NextToken`. Defaults and hard maxima are **100,000 data rows** and
   **1,000 pages**; callers may lower them via `maxRows` / `maxPages`. Cell text
   also has a cumulative **64 MiB** UTF-8 limit. Exceeding a limit fails rather
   than returning a truncated result or partially evaluated aggregate.
4. The first page's header must match column metadata exactly and is removed.
   Later pages are data, even if a row happens to equal the column names.
   Metadata must remain consistent; duplicate/missing columns, malformed rows,
   repeated pagination tokens and unsupported types fail closed.
5. Typed rows pass through the shared `evaluateSqlPlan` when table/level-aware
   calculations require it. A successful result contains `{ plan, rows,
   provenance: { source: 'live' } }`; injected fake clients use this same contract.

The default hard timeout is **60,000 ms**, configurable as `timeoutMs`. It covers
SDK calls (including stalled calls), polling and result retrieval; synchronous
mapping/post-processing checks the deadline before returning. `signal` aborts
active transport and throws the shared `ExecutionCancelledError`
(`EXECUTION_CANCELLED`). Timeout throws `EXECUTION_ERROR` with the fixed message
`Athena query timed out`. Both attempt `StopQueryExecution` once when an execution
ID is known; a late start response also attempts a stop. Stop errors are ignored
and cleanup waits at most one second. Cancellation before a start response has
no execution ID to stop. Every execution owns and destroys its client.

All raw SDK errors and Athena `StateChangeReason` text are hidden. Public errors
never include the server's SQL, credentials, output location or reason text.
Test-only client-factory, clock and sleep injection exercise these paths offline.

## SQL and result contract

Identifiers use double quotes, numeric expressions use `DOUBLE`, text casts use
`VARCHAR`, and datetime casts use `TIMESTAMP`. UTC ISO date/datetime parameters
have `T`/`Z` removed before the timestamp cast. Datetime projections use
`to_iso8601(CAST(value AS TIMESTAMP)) || 'Z'`; timestamp-without-zone source values
follow the existing UTC contract. Visual YEAR/MONTH/DAY grouping uses
`date_format(date_trunc(...), ...)`; QUARTER adds the explicit `quarter(...)`
label. All forms are pinned by exact SQL tests.

The scalar allowlist is: `sum`, `avg`, `count`, `min`, `max`, `distinct_count`,
`stdev`, `stdevp`, `var`, `varp`, `ifelse`, `coalesce`, `nullIf`, `isNull`,
`isNotNull`, `abs`, `ceil`, `floor`, `decimalToInt`, `toDecimal`, `concat`, `upper`,
`lower`, `strlen`, and datetime-only `toString`. Basic operators retain the shared
expression semantics, with explicit Athena cast types.

Datetime support includes `addDateTime`, boundary-based `dateDiff`, `truncDate`
(except milliseconds), and `extract`. Weeks start on Sunday; date differences
truncate to the requested boundary before `date_diff`, except millisecond
precision. `formatDate` supports fixed numeric tokens `yyyy`, `YYYY`, `yy`,
`MM`, `dd`, `HH`, `hh`, `mm`, `ss`, fractional `S`/`SS`/`SSS`, `a` and UTC
`Z`/`ZZ`, plus quoted literals. `now()` is captured by the shared expression
binder and emitted as a UTC timestamp value. Unsupported functions/arguments,
including `parseDate`, decimal/integer parsing, median/percentile, unimplemented
scalar functions and other format tokens, throw `UNSUPPORTED_FEATURE`; there is
no fallback to another dialect.

| Athena result type | Shared value |
| --- | --- |
| `tinyint`, `smallint`, `int`, `integer`, `bigint` | Number; unsafe integers retain exact wire strings |
| `double`, `float`, `real`, `decimal` (including precision/scale) | Finite number |
| `boolean` | `true` → 1, `false` → 0 |
| `varchar`, `char` (including lengths) | String |
| `date`, `timestamp` | String, preserving wire text |
| Missing `VarCharValue` for a supported type | `null` |

Complex types (`array`, `map`, `struct`/`row`), binary, JSON, intervals,
timezone-bearing timestamps and all unknown types throw `UNSUPPORTED_FEATURE`,
even with no data rows or all-null values. Invalid/nonfinite scalar payloads
throw sanitized `EXECUTION_ERROR`.

## Verification and remaining work

The offline fake sits at the **real SDK command boundary**. It proves request
shape, dispatch, typed rows, header handling, pagination, state transitions,
deadlines, stop attempts, pre-I/O security/config rejection and sanitized errors.
It does **not** parse Athena SQL, verify live parameter interpretation, exercise
IAM/S3 policies, establish engine-version equivalence or prove live-account
behavior. No tests call AWS. **Live verification in Tom's AWS account is his
follow-on.**

**Hosted source provisioning is also follow-on.** The existing host/port/database/
TLS and username/password endpoint model does not fit Athena. This issue does
not extend `QueryConnectorId`, hosted `/api/connectors` connection handling or web
data-preparation staging to Athena. Shared gallery metadata reflects the library
implementation; it does not establish a usable hosted source. The static demo
cannot execute Athena or connect to AWS. S3 now has a separate [file-source path](connector-s3.md); the remaining AWS
connectors are hosted stubs.
