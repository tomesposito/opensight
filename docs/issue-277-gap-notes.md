# Issue #277 — notebook persona journey

J11 uses the existing **Author** persona and real Chromium, Vite, local API and
hosted API stacks. The CSV upload and notebook authoring/publishing use the UI.
An initially empty input table, created through the real product API, supplies
mutable adjustments to the same SQL query as the uploaded prepared dataset.
No product or harness code, dependencies, or solution-design changes are included.

## Recorded gap: hosted unavailable notice

`hosted-unavailable-notice-regression` records a product mismatch with the
approved #281 expectation, not a request for hosted notebook execution:

- **Expected:** authenticated `GET /api/notebooks` returns HTTP 404; the page
  displays **Notebooks are not available on this server**, with neither a create
  form nor an error banner. This designed v1 state is a passing outcome.
- **Actual:** the real hosted API returns HTTP 503
  `HOSTED_CAPABILITY_UNAVAILABLE`; the admin page displays
  `HOSTED_CAPABILITY_UNAVAILABLE: Request failed`. No create form appears, but
  the unavailable notice is absent.
- **Cause visible in the tree:** unhandled requests reach the final
  `HOSTED_CAPABILITY_UNAVAILABLE` fallback in `packages/api/src/hosted-server.ts`.
  `packages/web/src/Notebooks.tsx` recognizes 404 or `RESOURCE_NOT_FOUND` as the
  unavailable state, not this 503 response.

The journey checks both the direct API response and rendered banner before
recording this specific expected/actual gap. Other responses or UI failures
remain test failures. The `hosted-notebook-boundary` pass means the observations
were verified; it does **not** mean the unavailable-notice requirement passed.
If the product later returns the approved 404 and notice, the same step passes
without emitting the gap.

Follow-up: align the hosted missing-notebook route response and unavailable UI
contract, preserving the absence of hosted notebook execution in v1. This is
outside the #277 test-only slice; no product fix or remote issue was submitted
under the build's no-network/no-push instructions.

## Standalone verification — 2026-11-17

The final `j11-notebooks.mjs` run exited **0**. Counts derived from the emitted
`.opensight/persona-journeys/j11-notebooks.json` are **11 passed / 0 failed /
1 gap**, with 10 screenshots:

| Step | Outcome |
| --- | --- |
| `local-governed-datasets` | Pass — uploaded all 8 CSV rows and created an empty adjustment table |
| `undeclared-dataset-denied` | Pass — `NOTEBOOK_SQL_UNDECLARED_TABLE`, no result data/table |
| `cell-by-cell-source-total` | Pass — only SQL cell 2 ran; East 500 / West 400 equals CSV total 900; local identity/time visible |
| `publish-and-separate-scratch` | Pass — Published app and separate Draft statuses; raw-result calibration |
| `published-run-view` | Pass — finished cells/narrative, no SQL editor or Save notebook, no scratch content; Run all returns 900 |
| `data-change-keeps-original-timestamp` | Pass — real East +100 mutation leaves the displayed 900 and its original timestamp/history unchanged |
| `rerun-fresh-total-and-history` | Pass — explicit re-run returns East 600 / West 400, newer timestamp; history grows 3 → 4, newest-first in UI and API |
| `byte-budget-visible-refusal` | Pass — named budget error and no result data/table |
| `byte-budget-oldest-run-evicted` | Pass — two successful runs retain only the newer run by ID; visible history count stays 1 |
| `hosted-unavailable-notice-regression` | Gap — expected 404/unavailable notice; actual 503/error banner |
| `hosted-notebook-boundary` | Pass — verified the specific response/banner and absence of a create form; gap above remains |
| `browser-health` | Pass — no page errors, external requests, or transport errors |

Budget calibration measured **181 bytes** for the grouped result and **377 bytes**
for the raw eight-row result. The second local stack uses run/notebook/store
limits of **181 / 271 / 724 bytes**, read at server construction. Thus the raw
result cannot fit, one grouped result fits, and two grouped results cannot fit
the notebook budget. All three environment values are restored immediately
after construction. Retention is checked by run ID and payload bytes, below the
20-run count cap; the store-wide eviction limit is not independently exercised.

The published run view is the reader-facing surface under the **same local
owner**. There is no distinct local Reader claim. Timestamp checks establish
that old results retain their execution time until an explicit re-run; they do
not claim an automatic data-invalidation banner or background refresh.

The standalone run used `TMPDIR=/tmp`, the localhost PostgreSQL database on
port 5433, `TZ=UTC`, and the installed Playwright Chromium headless shell via
`OPENSIGHT_CHROMIUM`. Loopback servers/browser execution required the sandbox
override. `npm run build` passed. `node --check` passed for J11 and run-all;
the runner has 11 entries, with J11 immediately after J10 and `Author` matching
the journey's persona. The aggregate run-all suite was not executed.

## Demo and visual review

`npm run build:demo --workspace @opensight/web` passed. A temporary capture
script served the rebuilt static demo and captured its Notebooks and Data
pages; both checks and browser health passed, with no horizontal overflow.
The static Notebooks page offers the local/organization API connection notice
and no create button. It was not presented as a deployed server.

Compared the current Data capture with `docs/images/data-landing.png` and the
supplied `lookfeel-references/qs-2026/qs-data-landing.jpg`, and the J11 published
run capture with `docs/images/notebooks.png`. Navigation, compact controls,
card/table hierarchy and spacing remain consistent with the existing captures;
the Data reference's populated catalog differs from the honest empty static
demo. No new visual defect was observed beyond the hosted error-banner gap.
There is no notebook-specific QuickSight reference and visual fidelity is not
measured. No user-visible UI was changed, so the README GIF and feature images
were not regenerated.

Captures and JSON remain in the ignored `.opensight/persona-journeys/` directory.
