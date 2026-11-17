# Issue #279 — prep join suggestions and step SQL

Built on `work/issue-279-prep-join-sql` under the supplied run brief.

## Item 3 — blocked by the preview architecture

The brief requires bounded preview diagnostics that never cause full source
scans, and explicitly instructs stopping an item that the existing compiler and
preview architecture cannot support safely. Item 3 is stopped under that rule.
No diagnostics query, endpoint, fabricated counts, or fan-out indicator was added.
The diagnostics fixture/fan-out tests requested in item 5 therefore cannot ship.

Evidence from the existing paths:

- `packages/query-engine/src/prep.ts`: `compilePrep` appends `LIMIT limit + 1`
  only to the final projection. Source relations, aggregates, windows, joins and
  their upstream CTEs are not input samples. A bounded output is not a bounded
  source read.
- `packages/query-engine/src/prep-executor.ts`: the DuckDB interrupt timer and
  PostgreSQL statement timeout cap execution at ten seconds, but execute that
  same final-output-limited query. They do not prevent full scans.
- `packages/api/src/hosted-prep.ts`: `preview` calls `load` before slicing
  `table.rows(limit)`. `load` obtains complete admitted leaf tables via
  `HostedData.table` and invokes the contained prep worker. Its limit of 1–500
  does not bound leaf reads or either join input.
- `packages/api/src/hosted-data.ts`: both `table` and the source `preview` path
  materialize the admitted source before returning a row slice. Reusing source
  previews would have the same problem. Tenant resource budgets reject excess
  work; they are not the requested preview sample limit.

Counts cannot be recovered from the joined preview alone: an inner join omits
unmatched inputs, and a capped result cannot establish duplicate multiplicities
on either side. Supporting the requested diagnostics needs an input-sampling
contract across compiler, source admission/staging, and both execution paths,
with one ten-second budget and explicit sample provenance. That contract is
absent today. The existing preview behavior is unchanged; no parallel compiler
or additional full-scan path was introduced.

## Shipped items

1. Shared `suggestPrepJoinKeys` returns unambiguous, case-insensitive whole-name
   matches with identical prep types. The editor lists hints for individual
   confirmation and omits already-configured pairs. New and staged joins start
   with empty keys; no type-only fallback is silently applied.
2. The existing Venn selector retains exactly left, inner, right and full. Each
   icon now has a visible label. Radio semantics, selection, arrow navigation,
   Home/End, and the filled Venn regions are covered by tests.
4. `PrepSqlView` displays `prepStepPlan`'s compiler SQL verbatim for every
   transformation, in both the selected-step summary and the configuration
   editor. Bound parameters are separate; unapplied edits update the result.
   Compiler errors replace the SQL with their named error. Prefix compilation
   permits repairing an early step while a later draft is invalid. Source
   bindings and dialects follow the existing canvas compiler context; this is
   not a server query log or an execution feature.
5. Existing root test globs include the new query-engine and web tests. Coverage
   includes suggestion ambiguity/type mismatch, explicit confirmation, all four
   Venn choices, exact SQL for all eleven transformations, both dialects,
   branches, prepared inputs, numeric draft normalization, and named errors.
   The changelog and data-prep semantics document describe the shipped features
   and explicitly exclude the blocked diagnostics.

No dependency, compiler dialect, join type, backend execution path, or bundle
format was added. `SOLUTION_DESIGN.md` is untouched. No merge, push, external
network access, or AWS operation was performed.

## Visual review

Rebuilt the static demo and all three embed entries with
`npm run build:demo --workspace @opensight/web`. Compared the new desktop/mobile
captures against the previous `docs/images/data-prep.png` and the supplied
`lookfeel-references/qs-2026/qs-data-prep-new.jpg`. The grouped Steps sidebar,
dotted left-to-right canvas, left/right column lists, compact Arial controls,
and bottom Configure/Preview area remain. Suggestions add a confirmation area;
SQL expands below the editor with its own horizontal scroll. Labels identify all
four Venn choices. Existing navigation/chrome/spacing/graph-layout differences
remain; QuickSight visual fidelity is not measured.

The browser run checks empty keys before confirmation, disabled Apply, named
errors replacing SQL, keyboard join selection, SQL updates before/after Apply,
and the honest schema-only static preview. Desktop (1280px) and mobile (390px)
have no document horizontal overflow. No page errors or external HTTP requests
were observed. No new visual defect was identified for a separate issue; the
no-network build constraint precludes remote issue filing.

`docs/images/data-prep.png` is refreshed. The README hero GIF was regenerated
using a local adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`
and its FFmpeg palette workflow (30 captured frames, held at 2 fps and encoded
at 10 fps for readable pacing). Temporary captures, the browser report, and the
adapted script are in ignored `.opensight/issue-279-verification/`.

## Verification

Focused item 1: **36 passed / 0 failed / 0 skipped**. Focused item 4 including
canvas, join, branching and Window regressions: **58 passed / 0 failed / 0 skipped**.
Strict TypeScript, the static demo/embed builds and browser checks passed.
Logs: `/tmp/issue-279-item1.log`, `/tmp/issue-279-item4.log`,
`/tmp/issue-279-demo-build.log`, `/tmp/issue-279-browser.log`.

Full root `npm test` exited **0** with `TZ=UTC`, `TMPDIR=/tmp`, `DATABASE_URL`
unset and `OPENSIGHT_CHROMIUM` set to the installed Playwright headless shell.
Node reporters total **5,613 passed / 0 failed / 37 skipped** (5,650 tests,
zero cancelled/todo). The Python SDK passed **32/32**. Combined root totals:
**5,645 passed / 0 failed / 37 skipped** (5,682 tests).

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,461 | 0 | 35 |
| Bundle parser | 211 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| TypeScript headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 856 | 0 | 2 |
| Web | 2,737 | 0 | 0 |
| Root conformance/site | 110 | 0 | 0 |
| **Total including Python** | **5,645** | **0** | **37** |

All 37 skips are live-Postgres checks: 36 require `DATABASE_URL`, and one
requires a live TLS PostgreSQL server. No browser tests skipped. The full run
used the sandbox override for local loopback and browser execution. Its log and
exit status are `/tmp/issue-279-npm-test.log` and
`/tmp/issue-279-npm-test.exit`; parsed counts are in
`/tmp/issue-279-test-counts.json`.

## Checkpoints

- `c0e000e8` — item 1: shared join-key suggestions and explicit confirmation.
- `60b705a6` — item 2: labeled four-way Venn choice and keyboard tests.
- `a41de8c3` — item 3: bounded-preview diagnostics blocker, per the brief.
- `cfd67b5d` — item 4: exact compiler SQL, parameters and named errors per step.
- Item 5 checkpoint: changelog, semantics, refreshed visual artifacts and full
  verification record.
