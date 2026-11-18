# Insight anomaly parity verification

This phase-plan fallback implements the Insight Anomaly computation. There is
no GitHub issue for the slice. Work stays on `work/parity-insight-anomaly`, with
one checkpoint per brief item. No merge, push, dependency addition, AWS call,
external network access or `SOLUTION_DESIGN.md` edit is part of this work.

## Behavior and compatibility

Both parser dialects validate anomaly bodies, IDs, names and detection options.
The native planner binds the computation's date dimension and SUM measure;
the web converter, configuration validator, author query and narrative compiler
use the same bindings. The preset leaves detection options absent, using BOTH
and no percentage filter. Native PascalCase options round-trip unchanged.

Detection uses the whole chronological non-null series, with at least five
points, median center, MAD spread and robust z-score threshold 3.5. Zero MAD
makes only nonzero deviations candidates. The optional percentage threshold
uses the absolute median; a zero median skips that extra filter. Direction
filters positive or negative deviations. Null counts are disclosed, duplicates
are rejected before null exclusion, and nonfinite values or arithmetic fail
closed. At most five anomalies are named chronologically, with the remainder
count disclosed. The exact method is documented in [Insight](insight-visual.md).

The native planner's existing collection rule restricts TopBottomMovers to
all-movers collections because they bind category plus time. Anomaly follows
Forecast and PeriodToDate: it can share one date dimension with other admitted
computations, but cannot mix with movers. No collection rule was relaxed.
Like sibling computations, optional names remain metadata; sentences use field
display names. Custom narratives remain unsupported.

## Divergences

QuickSight uses ML anomaly detection. OpenSight's deterministic robust
statistics are explicitly labeled statistical in the narrative and capability
copy; ML-result parity is not claimed. Sentence composition is OpenSight's,
and no matching QuickSight anomaly screenshot or measured visual fidelity is
available. Missing calendar periods are not filled. The existing visual empty
state remains, while the narrative function itself reports insufficient data.

## Verification

The resumed narrative passed strict web TypeScript compilation before its
checkpoint. Focused coverage, full-suite counts and demo capture evidence are
recorded here after the remaining verification item completes.

The README hero GIF is intentionally unchanged: the brief excludes it because
the tour never configures an Insight anomaly.
