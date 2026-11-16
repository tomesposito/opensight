# Issue #8 Phase A: connector registry

The supplied issue brief is the contract for this build; SOLUTION_DESIGN.md is
unchanged. `@opensight/query-engine` and its browser export expose the same frozen,
typed connector registry and strict validator. Unknown connectors, missing fields,
unknown fields, incompatible options and invalid values produce named
`ConnectorError` diagnostics. Validation never echoes supplied values.

Connection settings store environment variable **names**, never secret values.
S3 additionally stores plain bucket/key/prefix strings.
Database schemas use `hostEnv`, `portEnv`, `databaseEnv`, `userEnv`, `passwordEnv`
and optional `caEnv`. PostgreSQL uses `connectionEnv`. SaaS schemas use
`endpointEnv` and `tokenEnv`. AWS stub schemas use `regionEnv`, `resourceEnv`, and
`credentialsEnv`. Athena instead uses `regionEnv`, `databaseEnv`, optional
`workGroupEnv`, and `outputLocationEnv`, with the SDK default credential chain. S3 uses `regionEnv`, `accessKeyIdEnv`, `secretAccessKeyEnv` and optional
`sessionTokenEnv` with plain `bucket`, `key` and optional `prefix`. These
configuration contracts are not evidence
of authentication or vendor API compatibility. `connectConnector` validates and
returns availability; it never performs I/O or claims a successful connection.

| Module / connectors | Dialect | Connection semantics |
| --- | --- | --- |
| File (CSV, TSV, JSON, XLS, XLSX) | DuckDB | Local or authenticated staging; static demo requires an API |
| MySQL | MySQL | Operator-provisioned hosted sources and library executor; see [MySQL](connector-mysql.md) |
| PostgreSQL | PostgreSQL | Operator-provisioned hosted sources; no local self-serve setup |
| MariaDB | MySQL | Operator-provisioned hosted sources and library executor; see [MariaDB](connector-mysql.md) |
| Redshift (manual) | Redshift | Operator-provisioned hosted sources and library executor; loopback verified, live verification pending; see [Redshift](connector-redshift.md) |
| SQL Server, Presto, Trino, Spark, Snowflake, Teradata | None | Not yet implemented |
| Salesforce, GitHub, Twitter, Jira, ServiceNow | None | Needs a hosted connector implementation |
| Athena | Athena (Presto/Trino forms) | Library query executor; fake SDK coverage, hosted provisioning and live-account verification pending; see [Athena](connector-athena.md) |
| S3 | DuckDB file pipeline | Operator-allowlisted hosted source snapshots and bounded prefix browse; fake SDK coverage, live AWS verification pending; see [S3](connector-s3.md) |
| S3 Analytics, RDS auto-discovery, Aurora, Redshift auto-discovery, IoT Analytics | None | Needs a hosted connector implementation; no AWS calls |

There are 23 gallery entries: separate Redshift discovery/manual entries plus
Aurora and Trino. Manual Redshift has a dedicated dialect with explicit SQL and
wire tests; those tests do not establish live-cluster equivalence. Redshift
auto-discovery remains unimplemented. SaaS entries and the remaining AWS stubs share their respective schema
families intentionally, pending hosted implementations. Athena has its own
environment-name schema and dedicated SQL/type allowlists. S3 uses the existing
upload/prep parser, including the XLSX uncompressed-size guards, with no AWS
execution capability in the static demo. CLF is deferred beyond the
Phase A CSV/TSV/JSON/Excel scope. Per-connector tests cover validation, state and
explicit dialect availability; unsupported SQL never falls back to another engine.
