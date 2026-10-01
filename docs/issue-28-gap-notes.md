# Issue #28: working landing and honest empty states

Implemented on `work/issue-28-landing`, based on `c6d45595`. The issue brief
provides this slice's specification; `SOLUTION_DESIGN.md`, dependencies and
fixture pins are unchanged. No merge, publication, deployment or external
service access is part of this work.

## Landing and data semantics

The application starts in **Sample dashboard**, selecting `renderable-sales`
by ID independently of the developer example picker. The existing generated
fixture supplies all five visuals: bar, line, pie, KPI and table. The data is
the same reviewed reference result set used by the existing preview, with
region fixed to East, UTC months and discounted revenue equal to revenue × 0.9.
The displayed revenue is 500. No rows are invented and no query runs to populate
the landing; its notice explicitly identifies pinned synthetic sample data.

The offline demo opens directly to the sample. Hosted development retains the
session/invitation gate, then opens to the same sample for every role. The
existing mode values and capability gates remain intact, including hosted-only
administrator settings. Missing build fixtures produce recovery instructions
without falling back to another definition or invented rows.

**Developer fixture preview** retains the `fixtures` mode and both examples.
Its header, badge and notice identify definition inspection as a developer tool.
**API definition preview** retains the `api` mode and still fetches definitions;
its charts reuse pinned results only for an exact reviewed definition match.
Connecting an API does not turn those previews into live chart queries.

## Empty-state review

- Definition previews without rows say **Definition only**, identify the hosted
  source and access requirements, and state that no query runs in the preview.
- Other visuals without attached data say **Needs data**, with guidance to use
  a supported sample or query a configured dataset through a hosted API.
- Failed queries say **Unable to load data** with the original escaped diagnostic
  and guidance to check fields and data access before retrying. They never reuse
  sample rows to disguise a failure.
- Empty result sets say **No results**, with guidance to review filters and
  source data. Zero and null measures keep their distinct existing behavior.
- Pending queries use neutral loading copy. Empty and unavailable cards do not
  mount blank charts or tables behind the message. Standalone KPI compilation
  uses the same **Needs data** wording.
- Definitions without sheets and sheets without visuals explain how to add
  content. Author notices describe sample limits and query failures consistently.

The remaining embed-unavailable message already directs users to generate an
embed URL through the hosted API. Permission and expiry states retain their
existing recovery guidance. Data-preparation and execution notices already
identify hosted API requirements. No unrelated audit issues were implemented.

## Browser and visual review

Chromium exercised the current Vite app with
`VITE_OPENSIGHT_OFFLINE_DEMO=true` on loopback. The harness blocked external
requests and API requests, relaying only local Vite assets through Node to
accommodate this VM's Chromium local-network restriction. Assertions passed:
five populated cards, four real ECharts SVGs, a populated table, no landing
empty/error states, developer-preview navigation, return to the sales landing,
and preserved offline mode choices. Nine captures recorded zero page errors,
zero external requests and zero data requests. The 390px-wide landing has no
horizontal document overflow.

Comparison with `demo-explore.png` in the reference set confirms that the former
empty export landing is replaced by the populated sales dashboard. The
definition preview keeps its existing grid and provenance, with explicit
developer labeling and an explanation of the missing results. The builder
retains its Data → Visuals → canvas → Properties order and toolbar. Visual
fidelity is not measured; the footer still says so. No new user-visible gap was
identified, and no external issue was filed under the no-network instruction.

Review images: [sample dashboard](images/sample-dashboard.png) and
[developer preview](images/definition-preview.png). The author, data preparation
and data source README screenshots were refreshed for their changed notices or
mode-picker chrome. The README tour uses the supplied `readme-gif.mjs` storyboard,
adapted in `/tmp/issue-28-readme-gif.mjs` to the current offline Vite app with
external requests blocked and fixed frame counts for its hold intervals. The
supplied ffmpeg palette/assembly workflow produced 102 frames at 960×600 over
10.2 seconds; capture recorded no page errors or external requests. This is
local browser evidence, not a deployed server.

The issue brief reserves the static-demo rebuild for the orchestrator after
merge, so neither the main web build nor `build:demo` was run. Root `npm test`
does invoke the existing API build's embed-entry compilation; those generated
test prerequisites are separate from the main static demo.

Evidence: `/tmp/issue-28-browser.mjs`, `/tmp/issue-28-browser.log`,
`/tmp/issue-28-browser/`, `/tmp/issue-28-empty-final.log`,
`/tmp/issue-28-gif.log` and `/tmp/issue-28-gif/`.

## Full verification

The first full run received SIGTERM during the query-engine suite, before a
complete result was available; no assertion failure had been reported. That
interrupted run is not counted. The preview server was stopped after the media
refresh, and the full root `TZ=UTC npm test` is running again against
implementation checkpoint `d38a2dd8`. Exact workspace and aggregate counts will
be recorded after it exits.
The root command includes strict TypeScript checks and the new landing and
empty-state regressions through the existing web test glob. The final targeted
run passed 90 tests with zero failures or skips.
