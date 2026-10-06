# Issue #45: ASK Q side panel

Home and Author share `QSidePanel`. The native **Ask a question about …**
button opens a named, non-modal dialog docked to the right. It is 400px wide
on desktop and fits the viewport on narrow screens. The heading and Close
button remain visible while the answer scrolls. Controls use the editor's
Arial/Helvetica stack, 12px text, 13px headings and 4/8px spacing.

Opening focuses the question input. Escape and **Close Ask Q** dismiss the
panel and return focus to its trigger, including after **Close answer** or
**ADD TO ANALYSIS** removes the focused answer control. Closing unmounts the
interpreter and aborts its preview query; reopening starts a fresh question.

The existing `OEntry.tsx` interpreter and answer implementation are unchanged.
The panel displays the local/AI mode notice, **Interpreted question**, grammar
confidence, preview, source disclosure and **Did you mean…?** alternatives.
Only Author supplies a dispatch for **ADD TO ANALYSIS**. Hosted role checks
and published-dashboard query scope are preserved. Definition previews do
not expose the trigger. No API, bundle schema, dependency or
`SOLUTION_DESIGN.md` changes were made.

## Verification

Root `TZ=UTC npm test` exited **0** with **1,703 passed / 0 failed /
12 skipped / 0 cancelled**. All 12 skips are live-Postgres integration tests
because `DATABASE_URL` is unset. Strict TypeScript and root conformance passed.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 303 | 0 | 10 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| Interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 499 | 0 | 2 |
| Web | 646 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| Total | 1703 | 0 | 12 |

The panel, toolbar and definition-preview regression tests passed:
**23 passed / 0 failed / 0 skipped**. They cover both surfaces, focus,
dismissal, alternative selection, adding the selected interpretation,
capability denial/revocation, published query scope and cancellation on close.
The new tests are included by the existing root `npm test` workspace glob.

`capture-q-side-panel.mjs` passed in local Chromium with **0 page errors and
0 external requests**. It verifies Enter/Space opening, Escape/Close focus
restoration, answer actions, geometry and typography. Desktop Home is
1440×979; Author light/dark is 1440×900. Both mobile surfaces are 390×844,
without horizontal overflow. The desktop panel measures 400px; mobile 390px.

The existing local API/browser Q tour completed its assertions with **17
real dataset queries, 0 hosted O queries, 0 page errors and 0 external
requests**. It covers local sales, uploaded synthetic CSV rows (North 6,
South 3), addition to Author, dates, source expiry/recovery and the static demo.

The static demo and embed artifacts were rebuilt with `build:demo`, then the
brief's `build-demo-shim.mjs` refreshed the local single-file demo. This is a
static artifact, not a deployed server.

## Reference comparison and remaining gaps

The same-day baseline is
[Markdown](parity-baseline-2026-10-06-issue-45.md) /
[JSON](parity-baseline-2026-10-06-issue-45.json). Reference pixels, regions,
exclusions, viewports, themes and tolerance match issue #44 exactly. Private
references, configuration, captures and browser reports remain outside the
repository; committed report paths are reduced to basenames.

The Home pairing now opens Q and submits **revenue by region**. The checklist
marks the side panel and its question box present, and records the existing
alternatives now visible in the answer. The exact **Interpreted as** wording
remains absent intentionally: **Interpreted question**, **grammar match** and
**Local deterministic interpreter · No AI** stay honest. **ADD TO ANALYSIS**
is absent in the Home pairing and verified separately in Author.

| Region-weighted comparison | Issue #44 | Issue #45 | Change (percentage points) |
| --- | ---: | ---: | ---: |
| editor-classic overall | 46.25% | 46.55% | +0.30 |
| editor-newlook overall | 44.41% | 44.16% | -0.25 |
| q-generative overall | 40.67% | 40.99% | +0.32 |
| q-generative ask-q-panel | 48.85% | 61.83% | +12.98 |

The structural gap is closed; **pixel fidelity did not improve** in the Q
region. The open answer adds content where the previous capture showed the
dashboard. The reference has a different panel offset, query, line chart,
copy and surrounding layout. No aspect mismatch occurred and no exclusion
was added to improve a score. The existing brand/header differences remain
in the unchanged measured regions wherever the prior configuration includes
them. Empty editor canvases are capture state, not newly missing features.

For the next parity sweep, keep toolbar/header geometry and Q answer layout
in the gap backlog; any further work needs its own scoped brief. Build-for-me
still needs hosted AI and remains outside this issue. This build does not
publish or open remote issues.

## Documentation media

Refreshed the Home dashboard, Author empty/populated, radar, pivot, URL actions, uploaded
Q answer, local-data, local-drafts and expired-draft screenshots. Added a
dedicated Author Q panel screenshot to the README. The hero uses the brief's
`readme-gif-44.mjs` flow adapted for Q's trigger, plus an Author/add/save step:
**51 frames, 960×600, 10fps, 5.1 seconds**. Its capture recorded no page errors
or external requests. Only OpenSight demo screenshots are committed.
