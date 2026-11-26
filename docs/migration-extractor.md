# Customer-run QuickSight migration extractor

Issue #334 implements the first [D-97](idd/D-97-quicksight-migration.md) sequencing
step: a customer-run CLI and shared manifest/import-report contracts. v1 bundle
import and report storage, MCP migration tools, and Ask O migration guidance are
not implemented in this checkpoint. Existing local bundle import remains usable.

## Run in your own environment

Use Node 24+ and the repository's npm workspace installation. Build from the
repository root:

```sh
npm run build --workspace @opensight/migration-extractor
node packages/migration-extractor/dist/cli.js --help
node packages/migration-extractor/dist/cli.js --policy
```

The package also declares the `opensight-extract` executable. This checkpoint is
a repository workspace package, not a claim of a published npm release.

Set `AWS_ACCOUNT_ID` to your account and `AWS_REGION` (or `AWS_DEFAULT_REGION`) to
the extraction region. Use the standard AWS SDK v3 credential chain in your own
environment: an already configured profile/SSO session, temporary environment
credentials, or an assigned runtime role. `AWS_PROFILE` selects an existing
profile. The CLI never takes access keys, tokens, passwords, credentials files or
credential-output options. It neither writes nor alters AWS configuration.

```sh
node packages/migration-extractor/dist/cli.js --out ./migration-first
node packages/migration-extractor/dist/cli.js --out ./migration-next \
  --previous ./migration-first/manifest.json
```

On PowerShell, put the same arguments on one line and configure the environment
through `$env:AWS_ACCOUNT_ID`, `$env:AWS_REGION` and `$env:AWS_PROFILE`. Relative
paths using `/` work on either platform. These commands run AWS reads only when
the customer executes them; builds and tests do not call AWS.

Without selections, the CLI paginates analyses, dashboards and datasets for the
account/region. Repeat `--analysis ID`, `--dashboard ID` and `--dataset ID` to select
assets. Dependencies referenced by those definitions are included once. Missing
selections, duplicate inventory IDs, repeated pagination tokens and list failures
abort instead of pretending the inventory was complete. Describe failures appear
per asset without copying raw AWS errors. Cross-account or cross-region dependency
references fail the containing asset; no foreign Describe call is made.

List APIs have no namespace parameter. The CLI does not pretend that a namespace
flag can scope their results. Use selections and the credentials' own permissions.
Namespace/group access must be re-granted explicitly in OpenSight.

## Permissions and outputs

The shipped [read-only policy](../packages/migration-extractor/policy/read-only.json)
has exactly seven actions: ListAnalyses, ListDashboards, ListDataSets,
DescribeAnalysisDefinition, DescribeDashboardDefinition, DescribeDataSet and
DescribeDataSource. Lists require `Resource: "*"`; describes are limited to the
principal's own account and the four resource types. Operators can further narrow
region and asset ARNs. The sample ARN partition is commercial AWS (`arn:aws`);
adapt that partition for GovCloud/China. No write, SPICE ingest, export-job, S3 or
credential-fetch permission is granted. Dataset definitions use DescribeDataSet;
there is no DescribeDataSetDefinition operation in the installed SDK.

Each run writes two files to a **new** local output directory:

- `bundle.json`: the existing `QsBundle` envelope, `{ "members": [{ "path": ...,
  "resource": ... }] }`. Paths and IDs receive the same validation as `.qs` files.
  The UI JSON importer and local DefinitionStore accept this envelope as well as
  existing single-member JSON. Definitions contain names, expressions and source
  connection metadata; review the bundle before choosing to upload it.
- `manifest.json`: the versioned, content-free inventory described below.

The directory is created with mode 0700 and files with mode 0600 on POSIX systems.
Existing outputs, symlinks and URL destinations are refused. Output bounds match
the parser: at most 1,000 members and a 16 MiB JSON transport. Split larger work
into selections. Credential-shaped properties, AWS access-key material, private
keys and URLs containing user/password credentials are refused, including inside
unknown definition subtrees. Raw provider and filesystem errors are not printed.

Exit 0 means the inventory was extracted (possibly empty); exit 2 means at least
one asset failed closed; exit 1 means configuration, inventory or output failed.
A wholly failed or empty run writes an empty bundle with an honest manifest;
that empty bundle cannot be imported. Successful assets remain available after a
per-asset Describe failure. Extraction is a sequence of reads, not an atomic AWS
snapshot; quiesce edits or rerun and compare before cutover.

## Shared report contract

The contract lives in `@opensight/bundle-parser`, shared with the existing web
importer. Both portable artifacts carry `schemaVersion: 1`, producer
`opensight-migration/1`, `generatedAt` and the same `knownLimits` list.

The manifest inventories each asset by a SHA-256 identity key scoped to its
account, region, resource type and ID. It carries resource type, extracted or
failed-closed state, a fixed failure code, canonical JSON byte size, construct
counts, and a SHA-256 definition digest on successful extraction. No account IDs,
ARNs, names, expressions, column names, values, request IDs or raw errors appear.
Unknown schema keys use stable fingerprints instead of copying arbitrary text.

`diff` records added, changed, unchanged and removed identity keys. Canonical
digests ignore object key order and detect value-only changes without showing
those values. Failure and recovery are changes too. The first run is marked as
having no baseline. `--previous` accepts a validated manifest or a version-1
import report containing its manifest snapshot. Changed selections affect the
removed list; it means absent from this run, not proof of deletion in QuickSight.

The existing per-asset `ImportResult` now adds `asset`, `resourceType`, `findings`
and `coverage`. `serializeImportReport(results, { manifest, previous })` produces
the portable import-report envelope. Existing `path`, `name` and free-text
`messages` are session-local UI diagnostics; they are deliberately excluded by
the serializer. Persist or share the serialized report, never the raw UI array.

Every structured finding has a stable `kind` made from its construct and
`asset`, `visual` or `field-well` location. Ordinals identify its position without
customer names. Groups count occurrences and assets across the report; a kind
absent from a supplied prior report has `newKind: true`. Unknown construct names
are hashed so different new constructs still stand out.

Coverage counts explicit import units: asset options/bindings, declarations,
sheet properties, visuals, Insight computations and individual field-well
entries. Nested units are separate units, not byte-weighted or usage-weighted.
Each unit is clean, converted differently by design, or failed closed; buckets
include count and share of the total, with zero shares for an empty inventory.
Grid projection is a deliberate difference. Unsupported retained JSON and
unresolved connections are failures, never counted as deliberate success.
Children of a blocked visual remain blocked. These are conservative converter
coverage figures, **not measured visual or numerical fidelity**.

The native API-to-bundle projection was moved unchanged from the web package into
bundle-parser and re-exported at the old module path. Unknown subtrees and map
keys remain intact. The report extends the current importer; it does not change
which constructs execute, grant dataset access or weaken fail-closed checks.

## Known limits and cutover

QuickSight does not return source credentials. Re-create connections explicitly.
SPICE data is not extracted; re-ingest from the original source after remapping.
Dataset transformations and security configuration remain preserved definitions,
not executable OpenSight preparation or permission grants. Namespaces and groups
do not map one-to-one to tenants and members.

`assetExportFallback` is an honest unavailable seam. Definitions Describe cannot
reach need a customer-run asset-bundle export with customer S3. This CLI does not
start export jobs, choose a bucket, upload, download data or enlarge the policy.
The fallback `.qs` file can use the existing importer.

Move gradually: import one analysis, re-create its sources and permissions,
compare its numbers side by side with QuickSight, then move its readers. Repeat
for the next analysis. Rerun extraction against the prior manifest before each
cutover, and inspect changed assets and new finding kinds.

## Verification and remaining sequence

Tests use synthetic Describe response shapes modeled on the repository's
sanitized real export, the existing sanitized export itself, and injected SDK
command mocks. The only new external dependency is
`@aws-sdk/client-quicksight` 3.1169.0 (Apache-2.0); existing transitive versions are
unchanged. Live QuickSight verification is a customer/Tom step.

Continue in D-97 Q6 order:

1. **Complete:** extractor and shared report contract (build work items 1–3).
2. **Not implemented:** durable v1 bundle import and report read. Add an atomic,
   member-owned import/report store with tenant/namespace guards and replay
   semantics; retain unresolved definitions without granting executable bindings.
   Current `DefinitionStore` only loads local definitions, while the actual report
   is in `web/src/bundle-authoring.ts`. Existing v1 authoring requires resolved
   bindings; it cannot serve as an unguarded raw import route. Verify owner and
   cross-tenant denial, revocation, atomic failure and identical stored/read reports.
3. **Not implemented:** exactly two OpenAPI-registry-generated MCP operations over
   that v1 storage. Update CLI, both SDKs, generated MCP/audit registries and parity
   tests together; prove import/read/remap with delegating-member action history.
   Extraction must remain absent from the registry and MCP tools.
4. **Not implemented:** governed Ask O pre-import commands/policy explanation and
   post-import remediation grouped by kind. Load only the member's report, retain
   delivered-answer charging and spend caps, and prove every proposed fix requires
   confirmation through normal authoring. No new Ask O endpoint or automatic fix
   is included here.

Work item 7 is documented for the delivered slice. Work item 8 tests that slice;
the tenant/member-read, MCP import/remap and Ask O confirmation acceptance tests
remain with their unimplemented steps. `site/build-docs.mjs` does not consume this
page, the package README or the IDD; no generated public page changes are required.

## Hosted bundle import and report read

D-97 adds exactly two v1 operations: `POST /api/v1/bundle-imports`
(`import_bundle`) and `GET /api/v1/bundle-imports/{id}/report`
(`read_import_report`). Both require build capability. Local servers return
`HOSTED_API_REQUIRED`; extraction remains customer-side.

The import body has `importId` (1–128 identifier characters), `bundle` (the
extractor's JSON envelope), and optional `manifest`, `previousImportId`, and
`bindings: [{ asset, datasetBindings }]`. `asset` is the zero-based bundle member
ordinal; bindings use the existing analysis `{ kind, id }` dataset references.
The whole request is limited to 16 MiB. Credential material is rejected.

An import retains the original bundle and the shared report in one member-owned
metadata resource. Supported, fully bound analyses also enter normal authoring in
that transaction, with IDs `{importId}-{asset}`. Dashboards become unpublished
working analyses, recorded as a deliberate difference. Unresolved bindings,
unsupported constructs, datasets and data sources remain staged and cannot run.
Existing source/prep tools recreate connections and data; existing analysis tools
then accept reviewed definitions and bindings, or a new import can use bindings.
Imported QuickSight permissions never grant OpenSight access.

The response is `{ importId, report, targets }`; each target names its ordinal and
`staged` or `imported` state, with `analysisId` for imported targets. Report read
returns that exact `report`, without names, paths, rows or definition content.
Even another administrator cannot read another member's report. Repeated IDs
conflict; `Idempotency-Key` follows the existing v1 retry contract. The hosted owner
metadata migration upgrades the resource-kind constraint before runtime use.
