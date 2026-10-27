# Issue #141: interaction tests

`packages/web/test/interaction.mjs` loads the complete `style.css` plus the
app chrome, data, embed and sign-in styles for every browser fixture. Static
checks reuse those same source strings through `styles`.

Use `defineHoverCase(name, options)` for one interaction, or
`defineHoverCases(name, { html, cases })` to share a browser across cases.
Each case specifies `target`, the actual CSS `rule` (including `:hover`),
`resting` and `hovered` computed-property maps. `paintOnly` defaults to true
and compares the complete bounding rectangle. `unchanged` lists other
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
values. Clearing hover must restore the resting state. Regression tests
prove that wrong selectors and stronger overrides cannot produce the old
false positives.

Run a batch with `node --test --test-concurrency=1` followed by its test
paths. Root `TZ=UTC npm test` includes the harness regression tests and all
hover cases. Chromium must be installed locally; `OPENSIGHT_CHROMIUM` can
select its executable. No network service or new dependency is needed.
