# H3: durable sources and data authorization (#23)

H3 enables uploads and PostgreSQL sources in the H2 hosted server. Sources,
policies, encrypted payloads and prepared recipes use the H1 metadata database;
tenant routes never read the legacy JSON stores or fixture bindings. Source and
prepared IDs are scoped by tenant, namespace and owner. A tenant administrator
does not acquire another user's sources or prepared output.

## Configuration and lifecycle

`OPENSIGHT_SOURCE_ENDPOINTS` is an operator-supplied JSON array. Each PostgreSQL
endpoint has `id`, `host`, `port`, `database`, `tls`, and optionally `tenantColumn`.
An empty array permits uploads only. Tenant requests select an endpoint ID;
they cannot provide hosts, connection strings, socket paths or TLS options.
TLS verifies the server certificate. An operator `tenantColumn` adds an immutable
tenant-ID predicate outside the policy's OR expressions. Removing an endpoint
refuses sources bound to it. Restart after changing endpoint configuration.

Credentials use `OPENSIGHT_AUTH_ENCRYPTION_KEY` and the H2 AES-256-GCM envelope.
Associated data binds ciphertext to tenant, namespace, owner and secret ID.
Sources store references, never plaintext credentials. Upload rows are also
encrypted. Cryptographic authentication uses the existing native crypto helpers;
source credentials are not compared as application strings. API responses omit
credentials, secret IDs and connector diagnostics. Errors return named codes.

| Route | Operation |
| --- | --- |
| `GET /api/connectors` | File and PostgreSQL catalog |
| `GET /api/sources` or `/api/prep-sources` | Owner discovery with authorized columns or a named unavailability reason |
| `PUT /api/sources/:id` | Create PostgreSQL source with `connectorId`, `endpointId`, `schema`, `table`, `columns`, `credentials: {username,password}`, and explicit `policy` |
| `POST /api/sources/:id/bind` | Change binding or policy with `expectedVersion` |
| `POST /api/sources/:id/rotate` | Replace encrypted credentials with `expectedVersion`; invalidate derived admissions and caches |
| `DELETE /api/sources/:id` | Retire with `expectedVersion`; remove its encrypted payload |
| `GET /api/sources/:id` | Authorized schema |
| `GET /api/sources/:id/policy` | Owner/build policy inspection |
| `POST /api/uploads` | Existing upload `config`, canonical `base64`, optional `columns`, explicit `policy` and future UTC ISO `expiresAt` |
| `GET /api/uploads/:id` | Authorized preview |
| `POST /api/sources/:id/query` | Interactive `query`, optional `mode` |
| `POST /api/sources/:id/preview`, `/output`, `/rows` | Authorized rows; optional `columns`, `limit`, `mode` |
| `POST /api/sources/:id/refresh` | Populate owner cache; empty body |
| `GET /api/ai/sources`, `/api/ai/sources/:id/schema` | AI-capability discovery/schema through the same policy gate |

Policy uses the shared `rowLevel`, `rowRules`, `protectedColumns`, `columnGrants`
grammar; all referenced users/groups must exist in the current tenant. Missing
policy and unmatched protected rows are refused. Denied columns cannot be used
in projections, filters or calculated-field dependencies. Source creation,
mutation, upload and refresh require build capability. AI discovery requires AI
capability. Every request requires a verified tenant session.

H2 sessions remain bound to metadata revisions. Successful durable mutations
acknowledge the committed write, then the client must authenticate again before
its next request; the previous session is invalidated. Mutations reverify after
body intake, before writing. Reads reverify the session, revisions and upload
expiry immediately before sending a response.

Uploads become unusable exactly at expiry, including cached reads and prepared
dependencies. Startup and a minute timer remove expired encrypted payload records
even for suspended tenants; failed cleanup never authorizes an expired read.
Database pages and operator backups retain their own storage/backup retention
requirements; deleting a row is not a physical-erasure guarantee.

## Execution and pilot boundaries

Discovery, query, preview, output and AI schema enter `HostedData.admit` before
connector, payload or cache I/O. PostgreSQL and cached/upload DuckDB reads share
the projection/predicate compiler. Cached source snapshots stay internal and
owner-scoped; each returned result reapplies current RLS/CLS. Source/version and
tenant revisions invalidate cache admission. Refresh responses expose no raw
counts or protected schema. Blaze remains bounded, in-process and ephemeral;
restart preserves authorization and recipes but requires cache refresh.

Owner recipes use `/api/datasets/:id/prep`, `/prep/preview`, `/execution`, `/rows`,
`/query`, `/refresh`, plus `/api/prep-datasets` and `/api/prep-datasets/import`.
Saving requires `{name,pipeline,expectedVersion}`; importing accepts
`{resource,expectedVersion}`. Imported physical bindings or security assertions
cannot create source permissions. Full dependency graphs, joins, appends and
unused branches are admitted before any leaf or cached artifact is read.
Materialized dependencies require a current cache; there is no stale fallback.

HQ-4 stays enforced: protected prepared inputs return `PREP_SECURITY_REJECTED`.
Sharing and embedding prepared datasets return `PREP_SHARING_REFUSED` and
`PREP_EMBED_REFUSED`. Scheduled refresh intervals, hosted report/export handlers,
AI generation/provider execution, asset serving and legacy/anonymous embed
surfaces remain unavailable with named errors; none can bypass the hosted gates.
H3 adds no browser source-management UI or deployment.

## Maintenance migration

Complete H1's explicit legacy inventory/freeze first. Stop API and scheduler
writers. Keep affected tenants `provisioning` or `suspended` through H3 migration
and sealing. Ownerless/unmapped sources, unsupported bindings, unresolved prep
references and missing policy principals require operator repair; no rows are
silently discarded and no source is opened by migration.

Set `OPENSIGHT_SOURCE_MIGRATION_CONFIG` to a private JSON manifest containing
`migrationId`, `maintenance: true`, `backupDirectory`, and `sources`. Every source
in each included namespace must have one entry with `tenantId`, `namespaceId`,
`ownerId`, `id`, `binding` and `policy`. Version-3 bindings contain:

- PostgreSQL: `version: 3`, `connectorId: "postgresql"`, `state: "active"`,
  `columns`, `endpointId`, `schema`, `table`.
- Upload: `version: 3`, `connectorId: "file"`, `state: "active"`, `columns`,
  `rowCount`, future `expiresAt`.

A PostgreSQL entry names `credentialsEnv`, whose environment value is JSON
`{username,password}`. An upload entry names `uploadEnv` containing canonical
base64 bytes, and `uploadConfig` describing their format. Never put credential
or upload values in the manifest or repository. Configure the encryption key and
operator endpoints as above. SQLite additionally uses
`OPENSIGHT_METADATA_DATABASE`; the database must already have H1/H2 schemas.

After building the API, run from the repository root:

```sh
npm run sources:migrate --workspace @opensight/api -- migrate
# Review counts/checksum and the private versioned backup before cutover.
npm run sources:migrate --workspace @opensight/api -- seal
```

`SourceMigration` from `@opensight/api/metadata` provides the same operations for
the privileged PostgreSQL adapter. The CLI is SQLite-only; no HTTP migration
route exists. Migrate writes a checksummed, mode-0600 encrypted-payload backup,
then atomically replaces bindings, secrets and policy links with revision bumps.
An interrupted transaction rolls back; repeating the same manifest resumes from
the backup without requiring plaintext credentials again. Changed inputs or
backup contents refuse resume. Counts/checksums contain no data contents.

Before sealing, `sources:migrate -- rollback` restores the inventoried rows and
encrypted references. Sealing is the rollback boundary; it does not activate a
tenant. Resume/activate tenants through the operator lifecycle only after review.
Hosted startup rejects legacy bindings and committed-but-unsealed H3 migrations.
After cutover, remove old stores from serving configuration and retain private
backups under the operator retention policy. Never restart legacy JSON writers
or dual-write them alongside the durable store.
