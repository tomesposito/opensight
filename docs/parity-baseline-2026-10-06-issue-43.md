# Parity measurement baseline

Generated 2026-10-06T07:16:21.188Z by `@opensight/parity` (tolerance 16, equivalent below 5.0%).

> Scores are pixel-difference fractions, not fidelity grades: layouts, copy, data and fonts legitimately differ between a QuickSight product screenshot and the OpenSight demo, so absolute values are expected to be high. Use baseline-to-baseline deltas of the same pairing to judge whether a change moved fidelity; a region below the equivalent threshold reads as visually equivalent at this protocol.

## Top measured gaps (by region diff fraction)

| # | Pairing | Region | Diff | What the region holds |
| - | ------- | ------ | ---- | --------------------- |
| 1 | editor-newlook | toolbar | 99.8% | Blue menu toolbar: File..Search, Ask a question, FIT TO WIDTH, PUBLISH, NEW LOOK. |
| 2 | editor-newlook | header | 99.4% | Dark navy header with QuickSight logo. |
| 3 | q-generative | header-toolbar | 97.8% | Dark header + blue toolbar with 'Ask Q to build a visual'. |
| 4 | editor-classic | header-toolbar | 86.3% | Dark QS title bar + blue menu toolbar (File..Search, Add visual, PUBLISH). |
| 5 | editor-newlook | data-panel | 54.6% | Data panel: SPICE badge, Search Fields, CALCULATED FIELD, grouped fields. |
| 6 | q-generative | ask-q-panel | 48.8% | ASK Q side panel: NL query, 'Interpreted as', preview, ADD TO ANALYSIS, 'Did you mean'. |
| 7 | editor-newlook | visuals-panel | 44.1% | Visuals panel: ADD, CHANGE VISUAL TYPE gallery, ROWS/COLUMNS/VALUES field wells. |
| 8 | q-generative | data-panel | 43.7% | Data panel field list. |
| 9 | editor-classic | data-panel | 42.1% | Data panel: dataset selector, field list with type icons. |
| 10 | editor-classic | canvas | 41.7% | Analysis canvas: bar, line, stacked bar, geospatial map. |

## editor-classic — Classic analysis editor vs demo Author view

Reference 1206×783; capture 1440×935 normalized to 1206×783 (scale 0.838, crop 0,0). Overall region-weighted diff: **46.3%**.

| Region | Diff | Verdict | Excluded px | What it holds |
| ------ | ---- | ------- | ----------- | ------------- |
| header-toolbar | 86.3% | different | 1206 | Dark QS title bar + blue menu toolbar (File..Search, Add visual, PUBLISH). |
| data-panel | 42.1% | different | 0 | Data panel: dataset selector, field list with type icons. |
| visuals-panel | 35.6% | different | 0 | Visuals panel: visual-type picker and field wells. |
| canvas | 41.7% | different | 0 | Analysis canvas: bar, line, stacked bar, geospatial map. |

Structural checklist (recorded by hand at baseline time):

- ✅ Blue menu toolbar with File/Edit/Data/Insert/Sheets/Objects/Search — Demo toolbar carries the same menu items.
- ❌ Add visual CTA in toolbar — ADD is in the Visuals panel, not the toolbar. Corrected the original hand-recorded claim; this placement did not change in issue #43.
- ✅ PUBLISH button — Present in demo toolbar (honest stub until hosted).
- ✅ Data panel with field list and type icons — Present; demo groups fields (Geography/Metadata/Sales).
- ✅ Visuals panel with field wells — Empty ROWS/COLUMNS/VALUES wells and dimension/measure placeholders are visible in this capture; no visual is selected.
- ❌ Canvas populated with bar/line/stacked/map visuals — Demo capture shows an empty new-analysis canvas.
- ❌ Dark header with QuickSight logo — Demo uses the light OpenSight product header and a dark analysis bar. This brand/layout difference remains included in the measured regions.

## editor-newlook — New-look editor vs demo Author view

Reference 1206×676; capture 1440×807 normalized to 1206×676 (scale 0.838, crop 0,0). Overall region-weighted diff: **44.4%**.

| Region | Diff | Verdict | Excluded px | What it holds |
| ------ | ---- | ------- | ----------- | ------------- |
| header | 99.4% | different | 0 | Dark navy header with QuickSight logo. |
| toolbar | 99.8% | different | 0 | Blue menu toolbar: File..Search, Ask a question, FIT TO WIDTH, PUBLISH, NEW LOOK. |
| data-panel | 54.6% | different | 0 | Data panel: SPICE badge, Search Fields, CALCULATED FIELD, grouped fields. |
| visuals-panel | 44.1% | different | 0 | Visuals panel: ADD, CHANGE VISUAL TYPE gallery, ROWS/COLUMNS/VALUES field wells. |
| canvas | 36.3% | different | 0 | Canvas: donut chart + pivot table with expand/collapse groups. |
| properties-panel | 29.8% | different | 0 | Properties panel: Visual/Interaction tabs, Display settings, Pivot options. |

Structural checklist (recorded by hand at baseline time):

- ✅ Dark navy header — Demo has a dark navy analysis bar; not a full product dark header.
- ✅ Blue toolbar with Ask a question entry — Demo toolbar has 'Ask a question about Local sales'.
- ✅ FIT TO WIDTH / PUBLISH / NEW LOOK controls — All present in demo toolbar, including theme select.
- ✅ Dataset badge in Data panel — Demo shows a BLAZE badge where QS shows SPICE; intentional, declared.
- ✅ Grouped fields with type icons — Geography/Metadata/Sales groups present.
- ✅ Visual-type gallery in Visuals panel — Demo gallery covers the shipped visual types.
- ✅ Field wells (ROWS/COLUMNS/VALUES) — All three empty wells and dimension/measure placeholders are visible; this pairing still uses an empty analysis.
- ❌ Assigned field pills — No pills in this empty-analysis pairing. Selected-visual pill behavior is verified separately by the acceptance tour.
- ❌ Canvas with donut + pivot table — Demo capture shows an empty new-analysis canvas.
- ❌ Properties panel with Visual/Interaction tabs — Demo shows a 'select a visual' empty state.

## q-generative — Q generative BI vs demo Ask-a-question

Reference 1206×820; capture 1440×979 normalized to 1206×820 (scale 0.838, crop 0,0). Overall region-weighted diff: **40.7%**.

| Region | Diff | Verdict | Excluded px | What it holds |
| ------ | ---- | ------- | ----------- | ------------- |
| header-toolbar | 97.8% | different | 953 | Dark header + blue toolbar with 'Ask Q to build a visual'. |
| data-panel | 43.7% | different | 0 | Data panel field list. |
| canvas | 29.5% | different | 0 | Canvas: radar, scatter, donut, KPI. |
| ask-q-panel | 48.8% | different | 254 | ASK Q side panel: NL query, 'Interpreted as', preview, ADD TO ANALYSIS, 'Did you mean'. |
| build-for-me | 37.2% | different | 0 | 'Build for me' dialog: NL expression, INSERT EXPRESSION / TRY AGAIN / DISCARD. |

Structural checklist (recorded by hand at baseline time):

- ✅ Ask Q entry in toolbar — Demo toolbar and home page both have an 'Ask a question' entry.
- ❌ ASK Q side panel with NL query box — Demo Q is an inline panel on the home dashboard, not a side panel.
- ❌ 'Interpreted as' query interpretation — Demo shows 'Local deterministic interpreter' instead; honest offline limitation.
- ❌ ADD TO ANALYSIS action — No equivalent in the demo Q entry.
- ❌ 'Did you mean' alternatives — Not present.
- ❌ Build-for-me expression dialog (INSERT EXPRESSION) — Not present; generative mode needs hosted API (honest stub).

## Issue #43 comparison

This is a second run on 2026-10-06; the issue suffix preserves the original
baseline from earlier that day. The same reference pixels, region boxes,
exclusions, tolerance, fixture, viewport and normalization rules were used.
Capture paths now point to the rebuilt demo's private issue-43 captures.

| Visuals-panel region | Original baseline | Issue #43 | Change |
| --- | ---: | ---: | ---: |
| editor-classic | 33.03% | 35.57% | +2.54 percentage points |
| editor-newlook | 41.76% | 44.09% | +2.33 percentage points |

Both pixel-difference fractions increased. The structural gap of absent empty
wells is closed in the captured views; this is not a pixel-fidelity improvement.
The reference-aligned regions still compare different dock positions and canvas
contents. The Q pairing, whose UI did not change, moved less than 0.01 percentage
points in every region. No pairing has an aspect mismatch.

The checklist now records empty wells separately from assigned pills. The empty
pairings do not demonstrate pills or populated charts. The classic toolbar ADD
claim was also corrected: ADD is in the Visuals dock. No region or exclusion was
changed to improve a score. Reference and comparison pixels remain private.
