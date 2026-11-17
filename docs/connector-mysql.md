# MySQL and MariaDB connectors

MySQL and MariaDB are implemented query connectors in the hosted product API
(issue #270). Both use mysql2 3.24.4 (MIT), the MySQL wire protocol and the
`mysql` source-read dialect. A hosted operator provisions the endpoint and a
user-owned source; the app discovers its declared table/schema, prepares a
dataset and runs visual queries. The gallery only exposes the preparation
action when an available source of the matching connector is discovered.
It does not collect database credentials or create arbitrary connections.

## Hosted configuration and execution

`OPENSIGHT_SOURCE_ENDPOINTS` contains operator-owned endpoints with `id`,
`connectorId`, `host`, `port`, `database`, `tls`, and optional `tenantColumn`.
Set `connectorId` to `mysql` or `mariadb`; omission retains the existing
`postgresql` default. Creation, rebinding, migration and reads reject a source
whose connector does not match its endpoint with `SOURCE_ENDPOINT_DENIED`
(migration uses `MIGRATION_UNRESOLVED_SOURCE`).

Register through `PUT /api/sources/:id` with `connectorId`, `endpointId`,
`schema`, `table`, declared `columns`, `credentials` (`username`, `password`)
and an explicit `policy`. The same tenant/owner-scoped encrypted-secret trust
model as PostgreSQL applies. Operators supply deployment configuration through
environment variables; source bindings store endpoint identifiers and table
metadata, never connection destinations or plaintext credentials. Rotation uses
`POST /api/sources/:id/rotate` with the expected version and new credentials.

`GET /api/sources` and `GET /api/sources/:id` expose available bindings and
permitted columns. Discovery browses registered tables, not the server's entire
catalog. Source `output`, `preview`, `query` and `refresh` routes use the same
admission, budgets, immutable tenant predicate, row-level security (RLS),
column-level security (CLS), revision checks and BLAZE cache rules as PostgreSQL.
A denied column is rejected before secret, socket or cache access. Refresh
retains tenant-scoped internal rows; reads reapply current RLS and CLS.

Source reads use backtick identifiers, ordered `?` parameters and UTC
millisecond ISO strings (`DATE_FORMAT` projection). They use mysql2's text
protocol `query`, with a formatting hook that binds strings as UTF-8 hex
literals: the driver's default backslash escaping conflicts with the required
`NO_BACKSLASH_ESCAPES` mode. Quoted question marks are never treated as bindings.
A dialect-aware SQL guard suppresses oversized row payloads before driver
allocation; the sink also checks row/text/memory limits, including the
`maxRows + 1` sentinel. Connections have a maximum 3-second setup timeout and
10-second read deadline, honor cancellation, and are destroyed after each read.
Driver failures surface as sanitized `PREP_EXECUTION_FAILED` errors without
host, username, password or server error text.

Hosted `tls: true` uses certificate verification; `tls: false` is the operator's
explicit plaintext choice, matching the existing PostgreSQL contract. The
library executor below retains its separate TLS policy.

Hosted dataset preparation stages admitted source rows into DuckDB for shared
transformations. Browser schema validation mirrors this staging for MySQL and
MariaDB while retaining their source dialect and connector labels; it does not
emit native MySQL preparation SQL. Protected-source preparation remains denied
under the existing policy. The separate startup-configured local prep path
(`PrepPostgresBinding` / `streamPrepPostgres`) remains PostgreSQL-only. The
static demo has no database connections and is not a deployed API.

## Library executor

`executeMySql(request, { config, environment?, connectorId? })` defaults to
MySQL; `connectorId: 'mariadb'` selects its session/SQL variant.
`executeConnector('mysql' | 'mariadb', config, request, environment?)` routes to
this executor. Configuration still contains only environment variable **names**:
`hostEnv`, `portEnv`, `databaseEnv`, `userEnv`, `passwordEnv`, optional `caEnv`.
The planned schema must match the configured database. QuickSight `MYSQL` /
`MySqlParameters` metadata binds tables; it never supplies credentials or an
actual connection destination.

The library uses prepared positional parameters, including repeated expression
bindings, and validates plans before opening sockets. Verified TLS is enabled;
optional `caEnv` resolves a PEM CA value. The trusted library-only
`allowInsecureLoopback` option permits plaintext only on `127.0.0.1` / `::1`.
Setup/query timeouts are 3/10 seconds and each call destroys its connection.
Driver failures become sanitized `EXECUTION_ERROR` errors.

The SQL mapping targets MySQL 8.0.22+ (CTEs, double casts and the 0900 binary
collation). Date grouping/arithmetic/formatting, ordinary aggregates, numeric
and string functions have translations. Visual table and level-aware
calculations use shared post-processing. `parseDate`, `parseDecimal`, `parseInt`,
`median` and `percentile` still fail with `UNSUPPORTED_FEATURE`.

## MariaDB differences and verification limits

Both variants set UTC, `STRICT_TRANS_TABLES`, `NO_BACKSLASH_ESCAPES` and
`ONLY_FULL_GROUP_BY`. MySQL uses `utf8mb4_0900_bin` and
`max_execution_time = 10000` (milliseconds). MariaDB uses `utf8mb4_bin` and
`max_statement_time = 10` (seconds); it has neither MySQL setting. MariaDB
source RLS and generated library collation clauses use `utf8mb4_bin` too.
These collations are not claimed to have identical Unicode/trailing-space
semantics. Sharing the protocol/dialect is not a server-parity guarantee.

Unskipped root-suite tests use a local TCP MySQL-protocol harness with v10
handshake, native-password authentication, text resultsets and error packets.
They exercise the real driver through hosted source creation, discovery/schema,
dataset preparation, direct/cache/visual results, tenant/RLS predicates, CLS
bypass attempts, credential rotation, sanitized failures, bounds and
cancellation for MySQL/MariaDB. The harness evaluates a narrow source-query
subset using SQLite, so omitted predicates fail fixture assertions. It does
**not** reproduce all live MySQL/MariaDB semantics. Library tests cover mapping,
config validation, variant sessions and bounded connection failures.

SQL has not been differentially verified against a live MySQL or MariaDB
server. Live RDS MySQL / Aurora MySQL verification is Tom's follow-on step;
this build made no AWS calls or deployment changes. Other AWS/SaaS connector
entries retain their existing limitations.
