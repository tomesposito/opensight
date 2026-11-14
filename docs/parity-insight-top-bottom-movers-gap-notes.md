# Insight top/bottom movers parity verification

This phase-plan fallback implements TopBottomMovers for Insight, the last of
the ten documented insight computation variants that could not execute. There
is no GitHub issue for the slice: every open issue is Tom's / aws / planning /
needs-tom-local, and the only roadmap item (#163, embedding) is H11-gated. The
build was interrupted by a VM reboot after its first two checkpoint commits;
the watchdog resumed it from the saved brief on the same branch, preserving
the uncommitted compiler/narrative work. No dependency addition, AWS call,
external network access or `SOLUTION_DESIGN.md` edit is part of this work.

## Behavior and compatibility

Native `TopBottomMovers` and internal `topBottomMovers` accept a computation
ID, optional string name, `time`, `category` and `value` bindings, a required
`type` (TOP or BOTTOM), optional `moverSize` (integer 1–20, default 3) and
optional `sortOrder` (`PERCENT_DIFFERENCE` default, or
`ABSOLUTE_DIFFERENCE`). Malformed bodies, unknown properties and invalid
enum/size values fail closed with named errors in both casing dialects, and
the computation is retained unchanged on export.

Rows are grouped by (category, period). Each category's bound measure in the
latest dated period is compared with the preceding calendar period at the
bound grain — the GrowthRate/PeriodOverPeriod convention, so a missing
preceding period is never substituted with an older one. Percent uses the
shared relative difference; a zero previous value makes the percent
unavailable, which excludes the category under percent ranking (disclosed in
the count) but not under absolute ranking. Ties use the deterministic
typed-category order. Categories without a non-null value in both periods are
excluded and counted in the sentence. No eligible category produces an honest
unavailable sentence; empty results keep the existing empty state.

A visual whose computations include any movers computation must contain only
movers computations and exactly two Category-well dimensions (category first,
time second, as the wells projection collects them); mixing fails closed.
Author drafts keep the single-dimension model: movers configurations show as
imported computations in the Properties panel, no author preset is added, and
the author query and preview group by (category, time) using the time field
bound in the configuration, which rebinding keeps matched by column.

## Focused verification

Strict TypeScript compilation passed for the parser, web application and test
build. The focused suites passed **77 passed / 0 failed / 0 skipped**:
**10 bundle-parser insight tests** and **67 web insight tests** across eleven
files, including the new `insight-top-bottom-movers.test.mjs` and
`insight-top-bottom-movers-roundtrip.test.mjs`.

Coverage includes both casing dialects, malformed bodies and extra
properties, defaults and explicit mover options, wells projection order,
rebinding by column, mixing rejection, dimension binding failures, percent
and absolute ranking, deterministic ties, preceding-period substitution
refusal, zero-previous handling, exclusion disclosure, unavailable and empty
states, quarter labels, duplicate-pair and invalid-time rejection, compiler
execution over two wells, and a native round trip that converts, imports,
aggregates synthetic source rows with the shared query planner/evaluator,
renders the narrative and SVG, and exports/downloads the unchanged bundle.

## Gaps and limits

- Sentence composition is OpenSight's; QuickSight's exact narrative wording
  is not replicated and no visual-fidelity parity is claimed.
- Movers executes on the native/compiler path only; there is no author
  preset, and author drafts cannot create or edit movers configurations
  (they are preserved verbatim as imported computations).
- Only the latest period versus its preceding calendar period is compared;
  multi-period mover windows are not supported.
- The static demo has no movers visual, so there is no visual delta to
  screenshot-compare; the demo is rebuilt from the merged master as usual.
