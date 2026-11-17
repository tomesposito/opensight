# Issue #220 — input-table audit bounds

The local input-table JSON store prunes audit history on append, keeping the
newest 1,000 entries for the affected table before enforcing the 10,000-entry
overall cap. Audit GET supports optional pagination, and single-table and
audit reads use cloned projections. See [input tables](input-tables.md) for
the retention policy, legacy-store behavior and API parameters.

## Verification

The focused input-table suite passed 22 / failed 0 / skipped 0, including
nine new regressions and all 13 existing tests. Coverage includes both caps,
retention order, intact row details, oversized legacy-store loading and
persistence after pruning, pagination validation and response compatibility,
namespace isolation after deletion, nested clone isolation, and single-table
and audit routes avoiding full-store reads. The combined input-table and
automation-store run passed 27 / failed 0 / skipped 0.

## Static demo review

`npm run build:demo --workspace=@opensight/web` passed. Dashboard and author
captures at 1280 × 800 are byte-for-byte identical to the #219 captures when
using the same Chromium build. No page errors, external HTTP requests or
horizontal overflow were observed. The dashboard matches the data, navigation
and card arrangement in `docs/images/sample-dashboard.png`, with widths
adapting to the viewport. The editor retains the Data → Visuals/field wells →
sheet ordering in the private `qs-author-light-flow.jpg` reference. Existing
differences in banners, spacing and the empty canvas remain; no new visual
gap was found.

This API change leaves the UI layout and assets unchanged, so README media
were retained. The rebuilt artifact is a static demo; visual fidelity remains
unmeasured. Logs and captures are in the ignored
`.opensight/issue-220-verification/` directory.
