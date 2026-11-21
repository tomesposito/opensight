# Issue #297 — validate insight bindings before rebinding

The shared insight validator now checks every explicit `category`, `time`,
`value`, `fromValue` and `targetValue` binding before author wells can replace
it. Binding shape checks are extracted from normalization and reused there;
field existence and required dimension/measure counts remain in normalization.
The existing explicit-SUM requirement is retained. No new configuration or
dependency is needed. See [insight semantics](insight-visual.md).

`rebindInsight` validates the original configuration before replacement and
returns invalid configurations unchanged. This preserves errors through
`serializeVisual` for downstream compiler rejection. Author queries reject the
original malformed configuration with `null`, while draft admission still
accepts well-formed bindings to fields not yet assigned. Valid category, time,
measure and comparison changes still rebind; movers retain their separate time
dimension and current date grain.

## Focused verification

Strict web TypeScript compilation passed. The focused insight and author-query
suites passed **122 passed / 0 failed / 0 skipped**. The 17 new tests cover all
binding slots in all 11 computation variants, invalid wrappers and nested
objects, unknown variants/properties, malformed identifiers, unsupported date
grains and aggregations, serialization rejection, incomplete-draft admission,
and legitimate well changes. One existing import-report expectation now checks
the earlier named `INSIGHT_FIELD_UNBOUND` error for a missing column name;
its query-blocking and original-export assertions remain unchanged.

Verification logs and static-demo captures are kept in the ignored
`.opensight/issue-297-verification/` directory. Work remains on
`work/issue-297-insight-binding-validation`; no merge or push is performed.
`SOLUTION_DESIGN.md` is unchanged. No dependency, AWS call or external network
request was added.

## Static demo review

Rebuilt the single-file static demo with
`node packages/web/scripts/build-demo.mjs`. Dashboard, empty author canvas and
Insight summary captures at 1280 × 800 have no page errors, external HTTP
requests or horizontal overflow. The dashboard and empty author captures are
pixel-identical to the pre-change baseline. The Insight capture has 25,096
changed pixels confined to the existing auto-save/status strip: its two-second
timer fired before the new capture. The field docks, narrative and sheet canvas
have zero changed pixels; the summary still reports total revenue 900.

Compared the author capture with the private `qs-author-light-flow.jpg`
reference: the Data → Visuals/field wells → sheet arrangement is retained.
Existing banner, spacing and empty-canvas differences remain; no new visual gap
was found. README media are unchanged because this issue changes validation,
not UI presentation. QuickSight visual fidelity remains unmeasured. This is a
local static artifact, not a deployed server.

## Full root verification

The completed repository-root `npm test` exited **0**: **8,134 passed / 0 failed /
38 skipped / 0 cancelled / 0 todo**, comprising 8,172 tests including the Python
SDK. All skips are existing live PostgreSQL tests: 37 require `DATABASE_URL`,
and one requires live TLS PostgreSQL configuration. No browser test skipped.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,525 | 0 | 36 |
| Bundle parser | 213 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 2,588 | 0 | 2 |
| Web | 3,419 | 0 | 0 |
| Root conformance and site | 119 | 0 | 0 |

The run used `TMPDIR=/tmp`, `TZ=UTC`, `DATABASE_URL` unset and the installed
Chromium through `OPENSIGHT_CHROMIUM`, outside the sandbox for local fixtures.
An earlier foreground command received SIGTERM before producing suite totals;
that incomplete attempt is excluded. The successful persistent rerun is
recorded in `.opensight/issue-297-verification/root-npm-test.log`, with exit
status in `root-npm-test.exit` and exact suite counts in `root-test-counts.json`.

## Checkpoints

- `cd0913c2`: shared binding-shape validation and structural regressions.
- `af101480`: fail-closed rebinding/serialization and unfinished-draft coverage.
- `66c819ff`: zero-query regressions and legitimate well-change coverage.
- The final checkpoint records the changelog, semantics and full verification.
