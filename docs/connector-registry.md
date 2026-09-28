# Issue #8 Phase A: connector registry

The supplied issue brief is the contract for this build; SOLUTION_DESIGN.md is
unchanged. `@opensight/query-engine` and its browser export expose the same frozen,
typed connector registry and strict validator. Unknown connectors, missing fields,
unknown fields, incompatible options and invalid values produce named
`ConnectorError` diagnostics. Validation never echoes supplied values.

Configuration stores environment variable **names**, never addresses or secrets.
Database schemas use `hostEnv`, `portEnv`, `databaseEnv`, `userEnv`, `passwordEnv`
and optional `caEnv`. PostgreSQL uses `connectionEnv`. SaaS schemas use
`endpointEnv` and `tokenEnv`. AWS schemas use `regionEnv`, `resourceEnv`, and
`credentialsEnv`. These are preliminary configuration contracts, not evidence
of authentication or vendor API compatibility. `connectConnector` validates and
returns availability; it never performs I/O or claims a successful connection.

| Module / connectors | Dialect | Connection semantics |
| --- | --- | --- |
| File (CSV, TSV, JSON, XLS, XLSX) | DuckDB | Hosted upload staging; offline demo requires hosted API |
| MySQL | MySQL | Trusted environment configuration, server library executor |
| PostgreSQL | PostgreSQL | Existing server library executor |
| MariaDB | MySQL | SQL mapping only; connection not yet implemented |
| SQL Server, Presto, Trino, Spark, Snowflake, Teradata | None | Not yet implemented |
| Salesforce, GitHub, Twitter, Jira, ServiceNow | None | Needs hosted API / not configured |
| S3 Analytics, S3, Athena, RDS auto-discovery, Aurora, Redshift auto-discovery, Redshift manual, IoT Analytics | None | Needs hosted API / not configured; no AWS calls |

There are 23 gallery entries: separate Redshift discovery/manual entries plus
Aurora and Trino. Redshift is not assumed to be the PostgreSQL dialect; its
semantics need their own tests before execution. SaaS/AWS entries share a schema
family intentionally, pending hosted implementations. CLF is deferred beyond the
Phase A CSV/TSV/JSON/Excel scope. Per-connector tests cover validation, state and
explicit dialect availability; unsupported SQL never falls back to another engine.
