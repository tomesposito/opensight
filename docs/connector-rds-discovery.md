# RDS / Aurora / Redshift auto-discovery — issue #274

The three AWS auto-discovery registry entries — **RDS (auto-discovery)**,
**Aurora** and **Redshift (auto-discovery)** — are implemented as a **library
discovery service**, using the Apache-2.0 AWS SDK for JavaScript v3
(`@aws-sdk/client-rds` **3.1149.0**). Its installed `package.json` and `LICENSE`
were checked before wiring it in, matching the other AWS clients the project
already uses. No other dependency or license exception was introduced.

`discoverDatabaseSources(connectorId, config, options)` lists DB instances and
clusters in the configured region through the RDS API
(`DescribeDBInstances` / `DescribeDBClusters`) and classifies each by engine
into the manual connector a source created from it will use. It is exported
from `@opensight/query-engine`, **not** its browser entry. The three registry
entries share this one implementation and schema; the entry selects
configuration only.

## Configuration

Stored configuration contains only an environment variable **name**:

| Field | Required | Resolved server value |
| --- | --- | --- |
| `regionEnv` | Yes | AWS region |

There is no credentials field: `RDSClient` receives only `{ region,
maxAttempts: 1 }` (plus endpoint-redirect hardening) and uses its default
server-side credential chain. Missing or invalid environment values fail with
`CONNECTOR_NOT_CONFIGURED`; unknown fields or raw values in stored
configuration fail with `INVALID_CONNECTOR_CONFIG`. Config and region checks
finish before client construction or I/O.

## Classification

| API resource | Engine | Source connector |
| --- | --- | --- |
| DB instance | `postgres` | PostgreSQL |
| DB instance | `mysql` | MySQL |
| DB instance | `mariadb` | MariaDB |
| DB instance | `aurora-postgresql` | PostgreSQL |
| DB instance | `aurora-mysql` | MySQL |
| DB instance | `redshift` | Redshift (manual) |
| DB cluster | `aurora-postgresql` | PostgreSQL |
| DB cluster | `aurora-mysql` | MySQL |

Anything the API cannot classify stays **unlisted rather than guessed**, and a
resource with no usable endpoint (for example one still being created) is
unlisted for the same reason: it cannot become a source yet.

## The no-credentials rule

A discovery result contains exactly: `kind` (`instance` / `cluster`),
`identifier`, `engine`, the target `connectorId`, `endpoint`, `port`, and the
database name when the API reports one. The RDS API also returns master
usernames and other account detail; none of it is copied into a result, and
credentials are never discovered.

Creating a source is `rdsSourceConfig(discovered, envNames)`: every value is
an environment variable **name supplied by the user**, exactly as in the
manual flow (`connectionEnv` for PostgreSQL; `hostEnv`, `portEnv`,
`databaseEnv`, `userEnv`, `passwordEnv` and optional `caEnv` for the SQL
family). The built config must pass the target connector's own validation or
creation fails closed with `INVALID_CONNECTOR_CONFIG` — a credential value
where a name belongs is rejected there, not stored.

## Bounds and failures

Both lists are paged with `MaxRecords: 100` and `Marker` continuation: at
most **20 pages per list** and **1,000 discovered resources** in total. A
repeated marker, a malformed page, a duplicate identifier or a malformed
endpoint/port fails the whole call — discovery never returns a partial list
presented as complete. The hard timeout is **30,000 ms** (`timeoutMs` may
lower it); timeout throws `RDS_TIMEOUT`, and a caller `signal` abort throws
the shared `ExecutionCancelledError` (`EXECUTION_CANCELLED`). AWS failures
surface as sanitized named errors (`RDS_ACCESS_DENIED`, `RDS_REQUEST_FAILED`,
`RDS_INVALID_RESPONSE`, `RDS_LIMIT_EXCEEDED`); raw SDK messages, account
detail and server text never leak. Every call owns and destroys its client.

## Verification and remaining work

The offline fake sits at the **real SDK command boundary**. It proves engine
classification for instances and clusters, marker pagination, the
no-credentials rule, source-config creation against the manual connectors'
own validation, and sanitized failure handling. It does **not** exercise IAM
policies or prove live-account behavior. No tests call AWS. **Live
verification in Tom's AWS account is his follow-on**, as is hosted
provisioning: wiring discovery into the hosted source-creation API and the
web gallery's one-click flow builds on this library contract, and the static
demo cannot call AWS. S3 Analytics and IoT Analytics remain hosted stubs.
