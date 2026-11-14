# Insight unique-values parity verification

This phase-plan fallback implements UniqueValues for Insight. There is no GitHub
issue for the slice. The resumed build preserves the three completed checkpoint
commits on `work/parity-insight-unique-values` and continues with verification.
Merge, publication, the hosted demo shim and the builder matrix remain with the
supervisor. No dependency addition, AWS call, external network access,
`SOLUTION_DESIGN.md` edit or GitHub issue change is part of this work.

## Behavior and compatibility

Native `UniqueValues` and internal `uniqueValues` accept a computation ID,
optional string name and category binding. Extra properties, including value and
time fields, fail closed. The authoring select exposes **Unique values** and
serializes the generic preset with computation ID `uniqueValues`.

The narrative lists the bound category values from authorized aggregated rows
in deterministic JSON-typed order, matching the existing ranked-tie ordering.
Null is shown as `(null)`, field display names are respected, and category markup
remains plain text. The sentence is `Unique <category field name>: <value 1>;
<value 2>.` It contains no numeric parts, total or null-measure disclosure. Empty
results keep the existing empty state with no paragraph. Duplicate aggregated
categories and invalid measure values retain the shared fail-closed validation.

A native visual whose computations are all UniqueValues can bind zero Values
measures. Its author query uses an auxiliary COUNT to satisfy the shared planner;
the compiler discards that count and the narrative receives no measure values.
Authored visuals retain their existing Values well, which this computation does
not use. Other computation kinds, including mixed configurations, still require
one or two measures.

## Focused verification

Strict TypeScript compilation passed for the parser, web application and test
build. The focused suites passed **62 passed / 0 failed / 0 skipped**: **8 parser
tests** and **54 web Insight tests**, including `insight-unique-values.test.mjs`
and `insight-unique-values-roundtrip.test.mjs`.

Coverage includes both casing dialects, malformed bodies and extra properties,
category projection and rebinding, unbound-field rejection, zero-measure and
mixed configurations, deterministic ordering, null labels, display names, empty
results and authoring dispatch/serialization. The native round trip converts,
imports, aggregates synthetic source rows with the shared query planner/evaluator,
renders the narrative and SVG, and exports/downloads the unchanged bundle.

The initial sandboxed web run reported file-level totals. Repeating only the
focused Node commands outside the sandbox produced the individual test counts
above. Both invocations exited zero; no implementation or test changes were
needed. Evidence is retained under
`.opensight/insight-unique-values/verification/` in `focused-tests.log`,
`focused-tests.exit`, `focused-tests-native.log` and `focused-tests-native.exit`.

## Full-suite acceptance

The single repository-root `TZ=UTC npm test` run exited **0** on 2026-11-14:
**5,163 passed / 0 failed / 36 skipped / 0 cancelled** (5,199 tests, including
the Python SDK). `OPENSIGHT_CHROMIUM` selected the installed Playwright Chromium
headless shell, revision 1243. The command ran outside the sandbox for its local
API servers and browser tests. No demo build or capture ran concurrently.

All skips require live PostgreSQL: 35 require `DATABASE_URL`, and one requires
live TLS PostgreSQL configuration. H4 timing checks passed. No environment flake,
isolated suite rerun, weakened assertion or additional test skip was needed.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,294 | 0 | 34 |
| Bundle parser | 205 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 619 | 0 | 2 |
| Web | 2,665 | 0 | 0 |
| Root conformance and site checks | 110 | 0 | 0 |
| **Total** | **5,163** | **0** | **36** |

The verification directory retains `root-npm-test.log`, `root-npm-test.exit` and
`test-summary.json`, including the per-runner counts above. The supervisor's
independent acceptance run remains a separate step before merge/publication.

## Static demo and minimal offline captures

`npm run build:demo --workspace @opensight/web` exited **0**, including strict
TypeScript and all embed builds. A fixed-string search of
`packages/web/dist/opensight-demo.html` found **Unique values**. The verification
directory retains `demo-build.log`, `demo-build.exit`, `demo-unique-values.txt`
and `demo-sha256.txt`. This is a rebuilt local static demo, not a deployed server.

The maintained Insight tour does not include the UniqueValues preset. Following
the resume brief's minimal-check option, a local capture script reused its
navigation and checked the new preset against the rebuilt demo. It passed with
**2 captures / 0 page errors / 0 external requests**, with HTTP(S) requests blocked
throughout. Both light and dark views passed the 1440-pixel horizontal-overflow
check. The select shows **Unique values**, the SVG renders
`Unique region: East; West.`, and the existing revenue measure remains in its
Values well. Artifacts and `summary.json` are in
`.opensight/insight-unique-values/browser/`; the script is retained at
`.opensight/insight-unique-values/capture-preset.mjs`.

The first capture attempt expected the accessibility label to contain only the
narrative. The existing renderer also prefixes the chart title, so the capture
check was corrected to assert the complete label; the SVG text assertion stayed
exact. The successful rerun required no application or test-suite change. Both
capture logs and exit statuses are retained in the verification directory.

Visual inspection against the local `qs-author-light-flow.jpg` reference retains
the Data → Visuals/field wells → sheet arrangement and dominant canvas. The new
sentence fits within its card in both captures, and the preset is visible in
the properties panel. This is a qualitative layout check: there is no matching
QuickSight UniqueValues narrative reference, and no pixel-fidelity measurement
or controlled before/after screenshot comparison was performed.

The full maintained tour, README hero GIF and feature media were not regenerated
for this minimal verification. Native category-only import/query/export and
malformed-input behavior were verified by the automated suites, not additional
browser captures. No GitHub issue was created for this phase-plan fallback.

## Honest divergences

Sentence composition is OpenSight's; QuickSight's exact narrative wording is not
replicated. Visual fidelity is not measured. TopBottomMovers, anomaly and custom
narratives remain unsupported and fail closed. The list reflects the supplied
authorized aggregated result, rather than issuing a separate query to enumerate
an unrestricted dataset domain.
