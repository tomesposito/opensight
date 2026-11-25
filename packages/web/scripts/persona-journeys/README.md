# Persona journey tests

These scripts follow the persona and journey briefs in
`~/workspace/goals/opensight/files/personas-journeys/`. J1–J9 and J11 use real Chromium,
the real Vite app, and local API servers. There are no component mocks or
`page.setContent` app surfaces. Static site/demo and embed preview checks serve
the actual built files. J10 drives the real MCP server and hosted API directly,
without a browser or screenshots. This suite does not deploy anything.

## Run

Prerequisites:

- Node 24+, installed workspace dependencies, and built API/web/MCP-server packages
  (`npm run build` from the repository root).
- PostgreSQL listening on localhost:5433 with an `opensight` database and a
  user that can create/drop schemas. Each hosted journey uses a random schema
  and drops it during cleanup. The Orders fixture also uses temporary SQLite.
- For J1–J9 and J11, Chromium at `/opt/meta-chromium/chrome`, or set `OPENSIGHT_CHROMIUM`.
- For J1–J9 and J11, the existing `playwright-core` installation in
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

Run the MCP-only journey (no Chromium, Playwright installation, or AI provider needed):

```sh
export TMPDIR=/tmp
export DATABASE_URL=postgresql://postgres@localhost:5433/opensight
node packages/web/scripts/persona-journeys/j10-ai-agent-mcp.mjs
```

`DATABASE_URL` defaults to the localhost URL above when unset. J10 needs the
installed `@modelcontextprotocol/sdk` dependency and built
`packages/mcp-server/dist/index.js`; the root build provides the latter. On
restricted machines, allow localhost PostgreSQL connections and loopback listeners.

The runner executes J1–J11 sequentially in child processes. It sets the default
local PostgreSQL URL, disk-backed TMPDIR, and a shared output directory. Only
localhost network services are permitted. On restricted machines, allow the
scripts to launch Chromium and bind loopback ports.

The default output is `.opensight/persona-journeys`; override it with
`OPENSIGHT_PERSONA_OUTPUT`. Each script writes a JSON result; browser journeys also
write screenshots. J10 writes `j10-ai-agent-mcp.json` with `screenshots: []`, which
the runner accepts under the same validation contract.
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
| j7-operator | Operator | Operator UI provisioning, list/create/detail screenshots and inline usage, operator user list, browser admin enrollment and sign-in, removal confirmed by API/database |
| j8-embedding | Embedder (future) | Four offline preview states, branding, honest lack of active session |
| j9-ideas | Member + Operator | Member submission/isolation, operator review and decline reason, member follow-up, hosted-only local notice |
| j10-ai-agent-mcp | AI Agent | MCP-level: author_ai identity and scoped resources, regional draft, published metric version, identical CLS denied/missing errors, real BLAZE compute quota, PII field-name stop, managed AI spend cap, human draft review; workspace action history with delegating member identities |
| j11-notebooks | Author | Local CSV preparation, declared-dataset SQL and source totals, published run view versus scratch draft, data mutation and execution timestamps, calibrated result refusal and oldest-run eviction, hosted unavailable notice |

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
asserts a true empty hosted home. J4 now verifies a grounded AI answer using its
explicit test-only managed provider; live embedding remains a future journey. The generated
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

Issue #277: J11 uploads the sales CSV through the preparation UI, then declares
that prepared dataset and an initially empty input table in a notebook query.
An undeclared-table attempt fails visibly before the declared query returns
East 500 / West 400, matching the CSV total of 900. Publishing and reopening
selects the reader-facing run view; a separate scratch notebook remains Draft.
Both use the single local identity: this does not simulate a distinct Reader.
Adding East revenue 100 through the real input-table API leaves displayed results
labelled with their original execution time until an explicit re-run returns
1000 and grows newest-first history. The journey measures the JSON bytes of
grouped and raw results, then starts a second local stack with a run budget
that fits the grouped result but refuses raw rows, and a notebook budget that
fits one grouped run but not two. It restores the environment after construction
and checks the visible named refusal, absent result data, and oldest-run eviction
by ID. Exact calibration values are in the emitted step details. The hosted check
expects a real admin to see **Notebooks are not available on this server**, no
create form, and HTTP 404 from `/api/notebooks`: this is the designed v1 pass
under #281, not a gap. The current server instead falls through to HTTP 503
`HOSTED_CAPABILITY_UNAVAILABLE`, which renders an error banner. J11 records this
specific regression as `hosted-unavailable-notice-regression` with expected/actual
details; unrelated failures still fail. No product code is changed. See
[issue #277 gap notes](../../../../docs/issue-277-gap-notes.md).
Run it with `node packages/web/scripts/persona-journeys/j11-notebooks.mjs`.


Issue #190: J4 starts the hosted stack with `aiStub: true`, ten monthly credits,
and the test-only provider gate. `ai-answer-environment` must pass with a grounded
answer and reader-owned result rows. The runner rejects an environment gap for
that step. Other journeys keep their existing provider configuration. All model
responses are deterministic; no live provider or AWS access is needed.

Issue #276: J10 provisions a distinct `author_ai` fixture member and keeps the
administrator separate. Issue #332 changes `connectHostedMcp` in `harness.mjs`
to use the SDK's Streamable HTTP client and the app's `/api/mcp` endpoint by
default. It dynamically registers a public client, approves consent with the
member's real hosted session, and exchanges an S256-bound code for OAuth
credentials. Injected fetch forwards to `stack.apiTransport` on localhost with
`Host: opensight.test`; no outside connector is contacted. Set
`OPENSIGHT_J10_MCP_TRANSPORT=stdio` to retain the original linked
`InMemoryTransport` journey. Trusted fixture provisioning uses real auth, APIs
and Postgres metadata; every agent action uses MCP.

The agent sees its prepared datasets and accessible analyses/dashboards; a real
second member's private dataset/analysis is absent and direct probes return 404.
The delegated task creates an unpublished regional sales chart. A query using
the unpinned `__metric_weekly-sales` reference returns east 80 / west 40 and
published metric v4, while v5 remains an unpublished draft with tenfold values.
Issue #327 replaces the metric discovery gap with an MCP-only step: discover
Weekly sales by name, describe its publication, list published versions [2, 4],
then pin v2 and assert east 40 / west 20 and version 2 in the response. Pins to
draft v5 and missing v99 must fail with `METRIC_VERSION_NOT_PUBLISHED`.
For CLS, two previously published dashboards probe the same `secret_amount`
field: one source denies it and the other lacks it. `query_dashboard_visual`
must reach the security-aware planner and return identical HTTP 422 status and
full `UNRESOLVED_BINDING` bodies, without normalization. Allowed controls in both
fixtures must return 60. This does not count prepared-query
`PREP_SECURITY_REJECTED` or draft-validation `COLUMN_ACCESS_DENIED` as the proof.

The harness's optional `entitlements` overrides enable real hosted usage
accounting. J10 sets `computeAttempts: 1` and a BLAZE dataset: the first MCP
refresh succeeds, then a distinct refresh returns 429 `USAGE_LIMIT_EXCEEDED`.
The human reads the exact draft through their member API session and confirms
no published dashboard references it. The final `browser-health` step is the
shared harness check; J10 launches no browser and captures no screenshots.

J10 discovers 58 MCP tools including `ask_question` and `list_workspace_action_history`. Its dedicated member-owned
`ai-sales` fixture has columns `region,revenue`: east 17 + 31 = 48 and west 23.
The first managed stub ask returns the existing interpretation answer, then a
separate MCP dataset query verifies those totals. The stub reports 12 tokens;
`aiSpendCapCents: 12` and `aiCostCentsPerMillionTokens: 1_000_000` record exactly
12 cents. The second ask returns 429 `AI_SPEND_CAP_EXCEEDED` with no rows while
nine monthly AI credits remain. The PII field-name stop also passes (#328).

Issue #330 replaces the final audit identity gap with a passing assertion:
`list_workspace_action_history` returns the tenant's real audit trail, and each
MCP call since connection matches a distinct event with the delegating member
userId, tenant, path subject and status. This includes regional draft creation,
queries, and successful/denied `ask_question` calls. Direct human HTTP reads the
identical history; `/api/host/audit` still rejects the member. Seeded other-tenant
and NULL-tenant events are absent. Legitimate fixture/operator and administrator
entries in this tenant retain their own actor; the read never hides other members.
J10 has no remaining recorded gaps.
