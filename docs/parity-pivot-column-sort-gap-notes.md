# Pivot column sorting: verification and captures

## Implementation checks

The supplied offline phase-plan brief is the contract for this slice. Work is
on `work/parity-pivot-column-sort`, starting at `2108542a`. No dependencies, AWS,
external network calls, deployment, merge or push are part of the work.
`SOLUTION_DESIGN.md`, dependency manifests and lockfiles are unchanged.

Compiler validation covers both dialects and every sort nesting level. The
converter reuses the column schema and AggregationSort numerical shape, without
adding a FieldId. Category and pivot sorts share the same result-value
aggregation function and null-last comparator. Pivot ordering changes only the
outer column axis traversal; inner columns and rows keep independent ordering.

All 48 existing pivot-field-sort full-output hashes and all 72 aggregation-sort
hashes pass unchanged. Tests compare detail/subtotal/total cell identities for
all 16 pivot total/subtotal combinations. The existing duplicate-detail guard
remains; aggregate tests supply distinct detail groups across row dimensions.

Draft/import tests include default SUM, explicit-direction imports, foreign
measure IDs, native/bundle round-trips, retained invalid definitions, unrelated
edits, kind changes, visual/sheet remapping, and stale-reference cleanup.
Review identified that O-generated well replacement returns before the ordinary
reducer cleanup; that path now clears stale column sorts before draft validation.
The focused regression proves replacement takes effect and its draft persists.

## Focused verification

Strict TypeScript passed. The new file passed **72 passed / 0 failed / 0 skipped**.
The broader compiler, authoring, bundle, converter, Properties, O-dashboard and
sort regression run passed **434 passed / 0 failed / 0 skipped**. Logs:

- `/tmp/opensight-column-sort-new-tests.log`
- `/tmp/opensight-column-sort-focused.log`

The earlier ordering-only regression passed 261 tests. Intermediate authoring
checks caught two test-expectation mistakes: remaps use the established
`opensight_local_sales` identifier, and an imported empty list remains a
retained no-op. Both expectations now match the existing import/remap contract.

The sandboxed test runner initially reported only file-level counts. Reported
case counts come from the complete runs outside the process sandbox; no tests
were removed, weakened or skipped to bypass the environment.

## Demo and capture procedure

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and embed builds. Log: `/tmp/opensight-column-sort-demo.log`.
The artifact is a local static demo, not a deployed server.

`packages/web/scripts/capture-pivot-column-sort.mjs` loads the demo from `file://`
and blocks all external HTTP/HTTPS. It uses the installed Playwright headless
shell via `OPENSIGHT_CHROMIUM`. Before rebuilding, the old demo was copied to
`/tmp/opensight-before-column-sort.html` for the comparison run. Captures are
1440×900 and stay outside the repository as required by the slice brief:

`~/workspace/goals/opensight/hidden_files/issue-parity-pivot-column-sort/`

The script waits for autosave before taking comparison screenshots. An initial
bar-dark mismatch was confined to autosave status chrome (bounds x16–1262,
y88–185); seven other pairs already matched exactly. Waiting for the same
settled state makes the comparison meaningful without hiding any UI.
