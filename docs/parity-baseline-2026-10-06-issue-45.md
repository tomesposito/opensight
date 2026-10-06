# Parity measurement baseline

Generated 2026-10-06T19:20:40.171Z by `@opensight/parity` (tolerance 16, equivalent below 5.0%).

> Scores are pixel-difference fractions, not fidelity grades: layouts, copy, data and fonts legitimately differ between a QuickSight product screenshot and the OpenSight demo, so absolute values are expected to be high. Use baseline-to-baseline deltas of the same pairing to judge whether a change moved fidelity; a region below the equivalent threshold reads as visually equivalent at this protocol.

## Top measured gaps (by region diff fraction)

| # | Pairing | Region | Diff | What the region holds |
| - | ------- | ------ | ---- | --------------------- |
| 1 | editor-newlook | toolbar | 99.8% | Blue menu toolbar: File..Search, Ask a question, FIT TO WIDTH, PUBLISH, NEW LOOK. |
| 2 | editor-newlook | header | 99.4% | Dark navy header with QuickSight logo. |
| 3 | q-generative | header-toolbar | 98.1% | Dark header + blue toolbar with 'Ask Q to build a visual'. |
| 4 | editor-classic | header-toolbar | 86.4% | Dark QS title bar + blue menu toolbar (File..Search, Add visual, PUBLISH). |
| 5 | q-generative | ask-q-panel | 61.8% | ASK Q side panel: NL query, 'Interpreted as', preview, ADD TO ANALYSIS, 'Did you mean'. |
| 6 | editor-newlook | data-panel | 53.5% | Data panel: SPICE badge, Search Fields, CALCULATED FIELD, grouped fields. |
| 7 | editor-newlook | visuals-panel | 44.2% | Visuals panel: ADD, CHANGE VISUAL TYPE gallery, ROWS/COLUMNS/VALUES field wells. |
| 8 | editor-classic | canvas | 42.3% | Analysis canvas: bar, line, stacked bar, geospatial map. |
| 9 | editor-classic | data-panel | 41.7% | Data panel: dataset selector, field list with type icons. |
| 10 | q-generative | data-panel | 38.9% | Data panel field list. |

## editor-classic — Classic analysis editor vs demo Author view

Reference 1206×783; capture 1440×935 normalized to 1206×783 (scale 0.838, crop 0,0). Overall region-weighted diff: **46.5%**.

| Region | Diff | Verdict | Excluded px | What it holds |
| ------ | ---- | ------- | ----------- | ------------- |
| header-toolbar | 86.4% | different | 1206 | Dark QS title bar + blue menu toolbar (File..Search, Add visual, PUBLISH). |
| data-panel | 41.7% | different | 0 | Data panel: dataset selector, field list with type icons. |
| visuals-panel | 34.8% | different | 0 | Visuals panel: visual-type picker and field wells. |
| canvas | 42.3% | different | 0 | Analysis canvas: bar, line, stacked bar, geospatial map. |

Structural checklist (recorded by hand at baseline time):

- ✅ Blue menu toolbar with File/Edit/Data/Insert/Sheets/Objects/Search — Demo toolbar carries the same menu items.
- ✅ Add visual CTA in toolbar — Demo toolbar now carries a native 'Add visual' button ahead of FIT TO WIDTH (issue #44); clicking opens the visual-type gallery in the Visuals dock, scrolls it into view and moves keyboard focus there. Visual creation stays field-first (D-15): no orphan blank visuals.
- ✅ PUBLISH button — Present in demo toolbar (honest stub until hosted).
- ✅ Data panel with field list and type icons — Present; demo groups fields (Geography/Metadata/Sales).
- ✅ Visuals panel with field wells — Empty ROWS/COLUMNS/VALUES wells and dimension/measure placeholders are visible in this capture; no visual is selected.
- ❌ Canvas populated with bar/line/stacked/map visuals — Demo capture shows an empty new-analysis canvas.
- ❌ Dark header with QuickSight logo — Demo uses the light OpenSight product header and a dark analysis bar. This brand/layout difference remains included in the measured regions.

## editor-newlook — New-look editor vs demo Author view

Reference 1206×676; capture 1440×807 normalized to 1206×676 (scale 0.838, crop 0,0). Overall region-weighted diff: **44.2%**.

| Region | Diff | Verdict | Excluded px | What it holds |
| ------ | ---- | ------- | ----------- | ------------- |
| header | 99.4% | different | 0 | Dark navy header with QuickSight logo. |
| toolbar | 99.8% | different | 0 | Blue menu toolbar: File..Search, Ask a question, FIT TO WIDTH, PUBLISH, NEW LOOK. |
| data-panel | 53.5% | different | 0 | Data panel: SPICE badge, Search Fields, CALCULATED FIELD, grouped fields. |
| visuals-panel | 44.2% | different | 0 | Visuals panel: ADD, CHANGE VISUAL TYPE gallery, ROWS/COLUMNS/VALUES field wells. |
| canvas | 36.0% | different | 0 | Canvas: donut chart + pivot table with expand/collapse groups. |
| properties-panel | 29.7% | different | 0 | Properties panel: Visual/Interaction tabs, Display settings, Pivot options. |

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

Reference 1206×820; capture 1440×979 normalized to 1206×820 (scale 0.838, crop 0,0). Overall region-weighted diff: **41.0%**.

| Region | Diff | Verdict | Excluded px | What it holds |
| ------ | ---- | ------- | ----------- | ------------- |
| header-toolbar | 98.1% | different | 953 | Dark header + blue toolbar with 'Ask Q to build a visual'. |
| data-panel | 38.9% | different | 0 | Data panel field list. |
| canvas | 29.5% | different | 0 | Canvas: radar, scatter, donut, KPI. |
| ask-q-panel | 61.8% | different | 254 | ASK Q side panel: NL query, 'Interpreted as', preview, ADD TO ANALYSIS, 'Did you mean'. |
| build-for-me | 32.8% | different | 0 | 'Build for me' dialog: NL expression, INSERT EXPRESSION / TRY AGAIN / DISCARD. |

Structural checklist (recorded by hand at baseline time):

- ✅ Ask Q entry in toolbar — Demo toolbar and home page both have an 'Ask a question' entry.
- ✅ ASK Q side panel with NL query box — Shared right-docked ASK Q dialog contains the question box and full answer. Captured open on Home; Author and Home keyboard opening, Escape and focus restoration pass browser checks.
- ❌ 'Interpreted as' query interpretation — The answer visibly shows Interpreted question and confidence labeled grammar match. Exact QuickSight wording is deliberately not used; the local deterministic interpreter remains labeled No AI.
- ❌ ADD TO ANALYSIS action — Absent on this Home dashboard pairing because no author dispatch exists. Present and verified in the same QSidePanel in Author; adding the selected alternative creates a visual on the active sheet.
- ✅ 'Did you mean' alternatives — The submitted revenue by region question shows sum and average alternatives in the Home panel; selecting the alternative changes the preview. Existing interpreter behavior is unchanged.
- ❌ Build-for-me expression dialog (INSERT EXPRESSION) — Not present; generative mode needs hosted API (honest stub).
