# Persona journey browser tests

These scripts follow the persona and journey briefs in
`~/workspace/goals/opensight/files/personas-journeys/`. They use real Chromium,
the real Vite app, and local API servers. There are no component mocks or
`page.setContent` app surfaces. Static site/demo and embed preview checks serve
the actual built files. This suite does not deploy anything.

## Run

Prerequisites:

- Node 24+, installed workspace dependencies, and built API/web packages
  (`npm run build` from the repository root).
- PostgreSQL listening on localhost:5433 with an `opensight` database and a
  user that can create/drop schemas. Each hosted journey uses a random schema
  and drops it during cleanup. The Orders fixture also uses temporary SQLite.
- Chromium at `/opt/meta-chromium/chrome`, or set `OPENSIGHT_CHROMIUM`.
- The existing `playwright-core` installation in
  `/home/hatch/workspace/tools/screenshots`, or set `OPENSIGHT_SCREENSHOT_TOOLS`
  to its package directory. No new dependencies or browser downloads are needed.
- `unzip` for J5's exported bundle validation.

From the repository root:

```sh
mkdir -p "$HOME/workspace/.tmp"
export TMPDIR="$HOME/workspace/.tmp"
export DATABASE_URL=postgresql://postgres@localhost:5433/opensight
node packages/web/scripts/persona-journeys/run-all.mjs
```

Run one journey by substituting its script, for example:

```sh
node packages/web/scripts/persona-journeys/j3-first-dashboard.mjs
```

The runner executes J1–J8 sequentially in child processes. It sets the default
local PostgreSQL URL, disk-backed TMPDIR, and a shared output directory. Only
localhost network services are permitted. On restricted machines, allow the
scripts to launch Chromium and bind loopback ports.

The default output is `.opensight/persona-journeys`; override it with
`OPENSIGHT_PERSONA_OUTPUT`. Each script writes a JSON result and screenshots.
Every screenshot first checks horizontal overflow. Every browser context is
monitored for page errors and requests outside the synthetic origin, which is
bridged to the real local servers. Vite HMR is disabled for acceptance runs.
J5 also saves `j5-migration-export.qs`.

The runner writes `results.json` and `REPORT.md`, including per-journey counts,
expected/actual gap descriptions, and screenshot links. It removes each stale
JSON result before running its child and records crashes/missing results as
failures. Each child has a ten-minute limit. Gaps alone exit zero; assertion
failures, browser errors, external requests and process failures exit nonzero.

J1 builds the demo if `packages/web/dist/opensight-demo.html` is missing, then
runs the standard `~/workspace/goals/opensight/hidden_files/build-demo-shim.mjs`.
That shim must already exist; it updates the local published-demo artifact.
J8 builds its preview with `packages/web/scripts/build-embed.mjs` if missing.
These builds and the suite require no external network access.

## Coverage and findings

| Script | Persona | Main checks |
| --- | --- | --- |
| j1-discover | Evaluator | Homepage, crawler files, demo CTA, real SVG, supported Ask O question |
| j2-first-login | Workspace Admin | Browser invitation/password/TOTP enrollment for admin and reader, fresh-code sign-in, reader restrictions, named workspace picker |
| j3-first-dashboard | Author | CSV upload, calculated field, regional bar totals against CSV, draft reload |
| j4-reader-daily | Reader AI | Hosted Orders analysis, provider disclosure, reader navigation, available controls and geometry |
| j5-migration | Admin + Author | Real .qs import/report, exported ZIP members, saved imported asset |
| j6-self-host | Self-Hoster | Empty states, explicit sample opt-in, full API/Vite restart, durable CSV rows, no phone-home |
| j7-operator | Operator | Real provisioning API, operator user list, browser admin enrollment and sign-in, removal confirmed by API/database |
| j8-embedding | Embedder (future) | Four offline preview states, branding, honest lack of active session |

**Gaps are product findings, not test bugs.** They must state what was expected
and what the shipped product actually offers. Do not add fake data, bypass a UI
restriction, or relabel an assertion failure merely to obtain a green run.
Current findings include an imported Athena definition whose source is
unconfigured. J4 publishes and grants definition access through the product,
then checks both D-85 reader-filter outcomes: an independently provisioned reader
source initially denies access, then a trusted fixture policy update grants
access and the published recipe returns filtered reader rows (issue #155).
The allowed case requires 200 with the expected rows; 403 is a passing assertion
only in the explicit denied case, never a substitute for the allowed case. J2
asserts a true empty hosted home. The AI answer is environment-limited because the
fixture has no provider; live embedding remains a future journey. The generated
report is the authoritative record for the latest run.

Where the brief's labels differ, scripts follow the current UI and describe
the difference in step details. J2 and J7 open the mailed invitation in the real
browser, set a password, read the displayed base32 key, confirm a live code, and
sign in with a fresh code after its time step changes. No enrollment request is
made by hand. J2 retains the API membership acceptance for its already-enrolled
administrator's second workspace. Enrollment QR codes and setup keys are masked
in captures, including failure captures.
J4 copies the actual `hostedDataFixture` rows and recipe into its PostgreSQL
tenant, then uses real hosted HTTP handlers and built-in-auth fixture tokens.
It does not synthesize session/data responses. A persistent local draft is
reported as a draft; it is never counted as a published dashboard.
