# Issue #141: interaction tests

`packages/web/test/interaction.mjs` loads the complete `style.css` plus the
app chrome, data, embed and sign-in styles for every browser fixture. Local
imports are expanded in place, preserving the shipped cascade order. Static
checks reuse those same source strings through `styles`.

Use `defineHoverCase(name, options)` for one interaction, or
`defineHoverCases(name, { html, cases })` to share a browser across cases.
Each case specifies `target`, the actual CSS `rule` (including `:hover`),
`resting` and `hovered` computed-property maps. `paintOnly` defaults to true
and compares the complete bounding rectangle. Targets must have nonzero
geometry; `viewport` can select a responsive layout (for example, the
mobile navigation toggle). `unchanged` lists other
computed properties that must remain stable. A `dark` object overrides the
fixture or case data and runs the same assertions for dark chrome.

`excluded` contains selectors or objects with `target` and optional
`resting`/`hovered` maps. Excluded elements keep their resting values while
the target hovers, then receive hover themselves to check that the rule does
not apply. A separate case covers an excluded control's own hover rule.

The dependency-free Chromium pipe driver uses `CSS.forcePseudoState` on
the target and its ancestors. This activates browser style matching and the
normal cascade without changing inline declarations. Chromium does not
expose these inspector-forced states through `Element.matches(':hover')`,
so the harness checks `CSS.getMatchedStylesForNode` as well as computed
values. Clearing hover must restore the resting state. Geometry is sampled
after finite entrance animations finish, without disabling product CSS.
Regression tests prove that wrong selectors and stronger overrides cannot produce the old
false positives.

Run a batch with `node --test --test-concurrency=1` followed by its test
paths. Root `TZ=UTC npm test` includes the harness regression tests and all
hover cases. Chromium must be installed locally; `OPENSIGHT_CHROMIUM` can
select its executable. No network service or new dependency is needed.


The migration retains the 122 per-slice test files and their explanatory
comments. All 249 former browser targets remain covered. The four formerly
static-only files now exercise their selectors in Chromium too. The selected
sheet tab and enabled sheet-type card also receive real hover where the old
tests only checked structural matching.

Component-wide hover-rule totals in the calculation-dialog and palette/search
tests were replaced by cases for their specific fields and buttons. A search
of all web tests found no remaining stylesheet rule-count assertions. The
historical rule counts in explanatory comments are not assertions.

The author navigation fixture now uses the current product-header ancestry;
the fixture-picker select baseline includes the base select styles that its
old fixture omitted. No product stylesheet, dependency, token, changelog or
README image changed.

| Migration batch | Files | Passed | Commit |
| --- | ---: | ---: | --- |
| 1 | 20 | 130 | `e2893320` |
| 2 | 20 | 132 | `d6d3c78f` |
| 3 | 20 | 126 | `d29005af` |
| 4 | 20 | 117 | `e2db8d90` |
| 5 | 21 | 140 | `84ee26d0` |
| 6 | 21 | 121 | `076db178` |

Each batch used `node --test --test-concurrency=1` and had zero failed,
skipped or cancelled tests before its checkpoint commit.

The combined hover and harness audit passed **771 tests, 0 failed, 0 skipped,
0 cancelled** after the final coverage review. The static demo rebuilt with
`npm run build:demo --workspace @opensight/web`.

Final root verification: `TZ=UTC npm test`, with `DATABASE_URL` set to the
provided local PostgreSQL test service, exited **0**. The combined result
was **4,195 passed / 0 failed / 1 skipped / 0 cancelled / 0 todo**:
4,163 Node tests passed and all 32 Python SDK tests passed.

| Root suite | Passed | Skipped |
| --- | ---: | ---: |
| API | 834 | 1 |
| Bundle parser | 199 | 0 |
| CLI | 73 | 0 |
| Embedding SDK | 10 | 0 |
| Headless TypeScript SDK | 28 | 0 |
| Headless Python SDK | 32 | 0 |
| MCP server | 74 | 0 |
| O interpreter | 32 | 0 |
| Parity | 11 | 0 |
| Query engine | 520 | 0 |
| Web | 2,294 | 0 |
| Root conformance | 88 | 0 |

The sole skip was the existing live TLS PostgreSQL CLI integration test:
`OPENSIGHT_TEST_POSTGRES_CA` was not configured. Other live PostgreSQL
integration tests ran. No product-CSS specificity fixes or outstanding gaps
were needed for this issue.
