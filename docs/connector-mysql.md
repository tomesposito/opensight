# MySQL connector

`executeMySql(request, { config, environment? })` uses the shared planner with the
`mysql` dialect. `executeConnector('mysql', config, request)` resolves settings
from the server environment. Configuration contains `hostEnv`, `portEnv`,
`databaseEnv`, `userEnv`, `passwordEnv`, optional `caEnv`; values are environment
variable names. The planned schema must match the configured database.
QuickSight `MYSQL` / `MySqlParameters` metadata is accepted by metadata binding.
Metadata never supplies credentials or the actual connection destination.

Targets MySQL 8.0.22+ (CTEs, double casts, utf8mb4_0900_bin collation). Generated
SQL uses escaped backtick identifiers and prepared positional parameters,
including repeated expression bindings. UTC, strict SQL mode, no backslash
escapes, and binary text comparisons preserve explicit local semantics.
Date grouping, arithmetic, null handling, ordinary aggregates, numeric/string
functions and date arithmetic/formatting have MySQL translations. Table and
level-aware calculations continue through shared post-processing.
`parseDate`, `parseDecimal`, `parseInt`, `median` and `percentile` currently fail
with `UNSUPPORTED_FEATURE`; no foreign dialect syntax is emitted for them.

TLS certificate verification is enabled. Optional `caEnv` contains a PEM CA
value. A trusted library-only `allowInsecureLoopback` option permits tests against
127.0.0.1/::1; it rejects every other address. Connections have a 3-second setup
timeout and 10-second query timeout; each call destroys its connection. Driver
errors are replaced with a sanitized `EXECUTION_ERROR` that includes no
connection details. Security validation runs before opening a socket.

Tests cover SQL translation, malicious identifiers/filter values, configuration,
protected-data bypass attempts, shared post-processing, and a loopback TCP server
that closes the connection during setup. No live MySQL is required and no MySQL
test is skipped. SQL has not been differentially verified against a live MySQL
server; this is not a claim of measured server parity. MariaDB exposes a MySQL
SQL mapping but its connection path remains explicitly unimplemented.
PostgreSQL routes through the existing executor. All AWS/SaaS connections remain
honest stubs without network access.
