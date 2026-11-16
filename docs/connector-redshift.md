# Redshift (manual) connector — issue #271

`redshift-manual` is a Database query connector with its own `redshift` SQL
layer over the existing `pg` 8.23.0 driver (MIT). No dependency was added.
`redshift` auto-discovery remains an AWS hosted stub. This implementation has
loopback protocol and SQL-generation coverage; live Redshift behavior has not
been verified. Live-cluster verification in Tom's AWS account is his follow-on.

## Configuration and hosted flow

Library configuration contains environment variable **names** only:
`hostEnv`, `portEnv`, `databaseEnv`, `userEnv`, `passwordEnv`, optional `caEnv`.
For example, `hostEnv: 'REDSHIFT_HOST'` names an operator-provided environment
variable; it does not store the hostname. Unknown config fields or literal
credentials fail with `INVALID_CONNECTOR_CONFIG`; absent environment values
fail with `CONNECTOR_NOT_CONFIGURED`. `caEnv` resolves a PEM CA certificate.

`executeRedshift(request, { config, environment? })` and
`executeConnector('redshift-manual', config, request, environment?)` validate
and plan before opening a socket. QuickSight `REDSHIFT` / `RedshiftParameters`
metadata accepts `Host`, `Port` and `Database`; imported destinations never
supply a connection. The declared database must match the configured database.
The physical table schema is separate (for example, `public`). Cluster-ID
lookup is not implemented. Verified TLS is required; the trusted test option
`allowInsecureLoopback` allows plaintext only for `127.0.0.1` or `::1`.

For the hosted API, operators provision `OPENSIGHT_SOURCE_ENDPOINTS` entries
with `connectorId: 'redshift-manual'`, `id`, `host`, `port`, `database`, `tls`
and optional `tenantColumn`. Omitted `connectorId` still means PostgreSQL and
cannot bind a Redshift source. Creation, rebinding and reads enforce an exact
connector match (`SOURCE_ENDPOINT_DENIED`); migration enforces the same match
(`MIGRATION_UNRESOLVED_SOURCE`). TLS verifies certificates. For Redshift,
operator-configured `tls: false` is restricted to literal loopback addresses.

Register through `PUT /api/sources/:id`, supplying `connectorId`, `endpointId`,
`schema`, `table`, declared OpenSight `columns`, `credentials` and an explicit
`policy`. Credentials use the existing tenant/owner-scoped encrypted-secret
store. Source bindings retain endpoint IDs and table metadata, never plaintext
credentials. Rotation uses `POST /api/sources/:id/rotate` with the expected
version and replacement credentials.

`GET /api/connectors` includes manual Redshift. Source discovery and schema
routes browse registered tables and permitted declared columns; they do not
introspect a cluster catalog. An available matching source enables the existing
browser preparation flow. Preparation stages admitted source rows in DuckDB;
the browser retains the Redshift dialect and connector label while validating
those staged transformations. Source direct/BLAZE visual queries and prepared
visuals use the existing shared processing. Protected-source preparation retains
its existing denial. Native Redshift preparation SQL is not implemented.

## SQL and session contract covered by tests

Identifiers are double quoted, embedded quotes doubled, and names exceeding
127 UTF-8 bytes rejected. Values use `$n` wire parameters. Each connection sends
exactly these setup statements, in order:

```sql
SET TIME ZONE 'UTC'
SET enable_case_sensitive_identifier TO true
SET statement_timeout TO 10000
```

The identifier setting requests preservation of quoted names, including output
aliases. The library has 3-second connection and 10-second query timeouts.
Hosted reads have a 3-second connection cap and a single deadline of at most
10 seconds covering setup and rows. They stream pg row events without collecting
an additional result array. Cancellation closes the dedicated connection; no
PostgreSQL backend-PID query, cancellation function, transaction or SQL cursor
is used. Both paths close their connection after every operation. Driver errors
are sanitized to `EXECUTION_ERROR` (library) or `PREP_EXECUTION_FAILED` (hosted),
without server messages, hosts, usernames or passwords.

Generated SQL tests pin:

- `TO_CHAR(DATE_TRUNC(...))` for year/quarter/month/day grouping; UTC ISO
  millisecond `TO_CHAR` projection for datetime source and post-processing rows.
- `DATEADD`, `DATEDIFF` and `DATE_PART` date operations. Week truncation uses
  a one-day shift around `DATE_TRUNC('week', ...)` to request Sunday boundaries;
  week differences divide the truncated day difference by seven.
- Fixed numeric date-format tokens (`yyyy`, `YYYY`, `yy`, `MM`, `dd`, `HH`,
  `hh`, `mm`, `ss`, `S`, `SS`, `SSS`, `a`) and UTC `Z`/`ZZ` offsets.
  Other format tokens fail with `UNSUPPORTED_FEATURE`.
- Explicit `ORDER BY ... ASC NULLS FIRST` for grouped visual dimensions.
- An allowlist of shared PostgreSQL forms for ordinary aggregates, conditional,
  numeric and string functions; new PostgreSQL functions are not enabled
  implicitly. Redshift rounding uses a sign/floor expression. String literals
  and parameters use `VARCHAR(65535)` casts to avoid the default cast width.

`parseDate`, `parseDecimal`, `parseInt`, `median`, `percentile`, `mod` and
non-datetime `toString` fail with `UNSUPPORTED_FEATURE`. No `MAKE_TIMESTAMP`,
PostgreSQL `REGEXP_MATCH` array extraction or DuckDB `STRFTIME` is emitted.
Table and level-aware calculations retain shared post-processing.

Native-name and result-OID mappings are explicit:

| Native family | OpenSight representation |
| --- | --- |
| SMALLINT / INTEGER / BIGINT | INTEGER; unsafe-size integers remain exact strings |
| DECIMAL / NUMERIC / REAL / DOUBLE PRECISION | DECIMAL; nonfinite values rejected |
| BOOL / BOOLEAN | BOOLEAN in hosted rows; 1/0 in library result rows |
| CHAR / VARCHAR / TEXT | STRING |
| DATE / TIMESTAMP / TIMESTAMPTZ | DATETIME; hosted datetime projection uses UTC ISO text |
| TIME / TIMETZ | STRING, preserving wire text without inventing a calendar date |
| SUPER / GEOMETRY / GEOGRAPHY / HLLSKETCH / VARBYTE | `UNSUPPORTED_FEATURE` |
| Any unrecognized native type or OID | `UNSUPPORTED_FEATURE` |

Result types are checked even for NULL values and empty resultsets. Declared
hosted schemas accept only OpenSight column types; declaring an unsupported
native column as STRING does not bypass the wire-type check. The native-name
mapping is available as `redshiftType` for schema adapters, not automatic
catalog discovery.

## Security, bounds and verification limits

Hosted reads validate current RLS/CLS and immutable tenant predicates before
socket access. The SQL guard checks each row's combined text length using
`VARCHAR(65535)` and suppresses oversized payloads. A `maxRows + 1` sentinel,
row intake checks and the existing sink budgets enforce row/text/memory bounds.
The current policy and revisions also govern cached reads and rotation.

Root-suite tests use actual loopback PostgreSQL-v3 startup, authentication,
parameter binding, result fields/rows and error packets through `pg`. The hosted
harness evaluates a narrow SELECT subset with SQLite so missing tenant/RLS
predicates would leak fixture rows and fail assertions. Tests cover creation,
browsing, dataset preparation, visual queries, cache equality, security bypass
attempts, endpoint matching/migration, rotation, bounds, cancellation and errors.
Exact SQL and session statements are asserted independently.

The harness proves wire flow, fixture filtering and generated SQL text. It does
**not** prove live-cluster SQL semantics, collation, rounding or timezone parity,
TLS interoperability, or server-side cancellation completion. No AWS calls,
external database connections, deployment or publication were performed. The
rebuilt static demo remains a local artifact requiring a hosted API for sources;
visual fidelity is not measured.
