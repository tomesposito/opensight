# Customer-run QuickSight migration extractor

Issue #334 implements all four [D-97](idd/D-97-quicksight-migration.md) sequencing
steps: the customer-run extractor, shared manifest/report contract, hosted v1
import and report storage, MCP migration flow, and deterministic Ask O guidance.
Existing local bundle import remains available; hosted imports require the API.

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

## Verification and completed sequence

All four D-97 Q6 steps are implemented:

1. Customer-run extractor and shared manifest/report contract (work items 1–3).
2. Atomic, member-owned v1 bundle import and unchanged import-report read (item 4).
3. MCP import/read/remap flow through the same 60-operation registry, with member
   action history and no extraction operation (item 5).
4. Deterministic Ask O pre-import commands and post-import proposals, with normal
   authoring confirmation and unchanged generative governance (item 6).

Tests use synthetic Describe response shapes modeled on the repository's
sanitized real export, the existing sanitized export itself, and injected SDK
command mocks. The only new external dependency remains
`@aws-sdk/client-quicksight` 3.1169.0 (Apache-2.0). The interpreter and SDK reuse
existing workspace packages. No live AWS requests or spend are part of verification;
live QuickSight verification remains a customer/Tom step.

Targeted verification passed: 15 import/metadata tests, 86 MCP tests, 41
API/governance tests, 46 interpreter tests and 80 CLI tests, plus the Ask O UI
checks. Final root `npm test` verification on 2026-11-26 exited 0:
**8,660 passed / 0 failed / 38 skipped**. Every skip requires live PostgreSQL.
The full per-suite counts, corrected verification findings and static-demo
evidence are recorded in [the gap notes](issue-334-gap-notes.md). Staged assets
and unsupported constructs remain failed closed; the fixtures do not establish live service or numerical parity.

## Hosted bundle import and report read

D-97 adds exactly two v1 operations: `POST /api/v1/bundle-imports`
(`import_bundle`) and `GET /api/v1/bundle-imports/{id}/report`
(`read_import_report`). Both require build capability. Local servers return
`HOSTED_API_REQUIRED`; extraction remains customer-side.

The import body has `importId` (1–128 identifier characters), `bundle` (the
extractor's JSON envelope), and optional `manifest`, `previousImportId`, and
`bindings: [{ asset, datasetBindings }]`. `asset` is the zero-based bundle member
ordinal; bindings use the existing analysis `{ kind, id }` dataset references.
Direct hosted HTTP requests are limited to 16 MiB; existing MCP and serverless
transport envelope limits still apply, so large migrations should be split into smaller bundles. Credential material is rejected.

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

## Ask O migration guidance

Open **QuickSight migration guide** in the builder's Ask O panel. The standard
interpreter supplies POSIX/PowerShell commands for SSO, an existing profile or
existing temporary environment credentials. Keep the account ID and credentials
local; fill in the account placeholder and adjust profile, region and output
path before running. IAM explanations are generated from the shipped read-only
policy and checked for drift at build time.

For a CLI/SDK/MCP import, enter its ID in **Review stored import** in the hosted
Ask O guide. The request uses the existing governed Ask O operation and only reads
your own report; switching members discards a pending answer.

After a UI import, the guide reads the same shared report and groups proposed
remediation by finding kind. It shows counts for clean conversion, deliberate
differences and failed-closed constructs separately. Opening a proposal changes
nothing. Review and confirm each fix through Data sources, dataset preparation or
the normal analysis editor, and save there. Unsupported originals remain retained.

The existing `ask_question` operation also accepts a `migration` input instead of
`datasetId`, without adding a third v1/MCP operation:

```json
{"question":"Help me migrate","migration":{"phase":"before-import","setup":{"os":"posix","auth":"sso","profile":"migration-readonly","region":"us-east-1","outputDirectory":"./migration-001"}}}
```

For a stored import, use
`{"question":"Review this import","migration":{"phase":"after-import","importId":"migration-001"}}`.
The server resolves the report using the authenticated importing member; caller-
supplied reports, credentials, and apply instructions are rejected. The optional
pre-import manifest supplies inventory and change counts. Every post-import item
has `requiresConfirmation: true`; the answer has `applied: false`.

This deterministic interpreter path uses no provider, AWS transport, AI credits or
AI spend. It remains available with AI generation disabled or credits exhausted,
subject to the existing Ask O/build permissions. Managed generative answers still
charge on delivery and enforce the existing spend cap. Migration guidance never
bypasses those generative rules or performs an authoring mutation.
