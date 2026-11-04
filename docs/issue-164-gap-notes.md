# Issue #164 — notebook v1 gap notes

The 2026-10-30 decided IDD is implemented on the local/organization
`createApiServer` only. There is no deployment or hosted-support claim.

- **Hosted routes/storage:** `createHostedApiServer` is unchanged. Hosted assets,
  operation admission, transport, persistence and quota integration remain a
  follow-on. UI requests to a server without notebook routes report the failure
  and explain this limitation.
- **Python/R:** out of v1; separate product/sandbox decisions required.
- **Notebook AI agent:** out of v1; separate decision required. No notebook AI
  assistance was added.
- **Scheduled snapshot refresh:** follow-on. The local scheduler runs existing
  prep/refresh/report jobs; it has no clean notebook-job ownership/destination
  seam. V1 refresh is manual re-run and save, with a new immutable snapshot ID.
- **Metering:** no local query-metering hook exists in `createApiServer` or
  `PrepRoutes`. The optional `hostedUsage` wiring there only supplies `aiMeter`.
  Local notebook queries therefore match existing unmetered local queries.
  Hosted notebook work must reuse #154 quota/metering hooks; no second meter was
  built. The #159 seam supplies cache budgets, not universal row/time constants;
  this build reuses its 8 MiB entry budget plus existing prep row/text bounds and
  the prep/MySQL 10-second execution bound.
- **Snapshot-as-dataset:** notebook-store fallback shipped. Existing prep asset
  creation stores recipes, and upload ingestion accepts staged files rather than
  arbitrary already-governed result tables. Snapshots are private datasetRefs
  across the caller's accessible notebooks, with visible as-of/truncation and
  original source authorization retained. Normal dataset asset registration and
  dashboard/analysis consumption remain follow-ons.
- **Visual/compiler seam:** SQL results return from the API, and the web uses the
  shared prepared evaluator plus the existing visual compiler/ECharts component.
  No fake server chart or alternative rendering path was added.
- **SQL scope:** SELECT, nonrecursive CTEs, joins, set operations and reviewed
  scalar/aggregate functions are supported. Table functions, qualified source
  names, recursive queries and unreviewed functions fail closed with named
  errors. Raw SQL remains forbidden on the general query endpoints.

See [notebooks](notebooks.md) for API, retention, permission and snapshot semantics,
and [D-91](itd/D-91-notebook-sql-boundary.md) for the SQL boundary implementation.

## Verification

Final targeted validation passed **71 / 0 / 0**: 28 SQL safety/execution tests,
18 API/model tests, and 25 web aggregation/interaction tests. This includes a
real 10-second query interruption and security-policy replay tests. All are discovered by the existing
root test scripts. Strict TypeScript is enabled and no dependencies were added.

The initial full workspace run found one outdated navigation-order expectation;
it now includes Notebooks beside Data. The corrected navigation suite passed
**31 / 0 / 0**. The independent conformance/documentation check passed
**102 / 0 / 0**. The full root command was restarted after that correction.

Final full root suite (supervisor's independent run after the build VM rebooted
mid-verification, TZ=UTC, live Postgres on :5433, headless-shell Chromium):
**4,723 tests — 4,722 passed / 0 failed / 1 skipped**, plus the Python SDK
suite (32 tests, OK). Exit 0.

## Visual verification — 2026-11-04

`packages/web/scripts/capture-notebooks.mjs` drove a real local API with synthetic
sales: edited/published a notebook, ran its parameterized app, rendered the shared
compiler chart, saved a snapshot, and inspected the 390px mobile view. Seven
captures completed with **zero page errors, zero external requests and no tested
viewport overflow**. The static demo was rebuilt with `npm run build:demo
--workspace @opensight/web`; its notebook page correctly offers no persistence
or execution controls.

Screenshot comparison used the existing Data workspace and the supplied
`lookfeel-references/qs-2026/qs-data-landing.jpg`: compact Arial controls, the left
navigation, clear page hierarchy and docked navigation remain consistent.
Checkbox alignment and native button styling found during review were fixed.
No notebook-specific reference exists and visual fidelity is not measured.
No unresolved issue-specific visual defect was observed; no remote issue was
filed under this build's no-network boundary.

The README hero GIF was regenerated with `capture-readme-tour.mjs` (the repository
adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`) and its ffmpeg
palette/assembly commands: 253 frames, zero page errors and zero external
requests. Refreshed images include the sample dashboard, Data landing page,
navigation rail, and a new notebook run screenshot. These are local captures,
not a deployed server. Logs and captures are in `/tmp/issue164-*`.
