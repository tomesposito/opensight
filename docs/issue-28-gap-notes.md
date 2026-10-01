# Issue #28: working landing and honest empty states

Implemented on `work/issue-28-landing`, based on `c6d45595`. The issue brief
provides this slice's specification; `SOLUTION_DESIGN.md`, dependencies and
fixture pins are unchanged. No merge, publication, deployment or external
service access is part of this work.

Final verification uses `/tmp/opensight-issue-28-verify`, an isolated worktree of
the same branch. The shared checkout changed to `work/issue-27-first-run` during
verification; it was left on that branch. Existing installed dependencies were
copied locally with workspace links resolving inside the isolated worktree.

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

Earlier shared-checkout attempts are not counted: one received SIGTERM during
the query-engine suite, and another was stopped when the checkout changed to
issue #27. The second attempt also hit the existing H4 timing assertion at
3,016.7 ms against its 3,000 ms execution ceiling; this had passed in the first
attempt. An isolated attempt also exceeded that timing limit while another
`npm test` was running in the shared checkout. That other process was left
alone; this run was restarted after it finished. H4 then passed with maximum
execution time 1,493.9 ms and competitor latency 2,648.2 ms. No backend code or
timing thresholds were changed. The clean worktree needed
`npm run build --workspace @opensight/o-interpreter` before the API's compiler
build could resolve its generated declarations; that prerequisite was built
locally without changing package scripts.

The final root `TZ=UTC npm test` exited **0** in the isolated worktree with
**1,473 passed / 0 failed / 9 skipped** (zero cancellations). All nine skips
are live PostgreSQL integration tests because `DATABASE_URL` is not set.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 241 | 0 | 7 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 496 | 0 | 2 |
| Web | 500 | 0 | 0 |
| Root conformance | 3 | 0 | 0 |
| **Total** | **1,473** | **0** | **9** |

The run verifies implementation checkpoint `d38a2dd8` and media checkpoint
`09720e6d`; the final commit only completes these notes. Strict TypeScript and
public-entry checks ran through the workspace scripts. The 18 new web tests
cover populated first renders for demo and every hosted role, mode retention,
preview navigation, missing fixtures, session gating, developer labeling and
honest missing/empty/loading/error states. The final targeted run passed 90
tests with zero failures or skips.

Exact runner output is retained in `/tmp/issue-28-exclusive-tests.log` and its
exit status in `/tmp/issue-28-exclusive-tests.exit`. `git diff --check` passes.
All checkpoints are committed only on `work/issue-28-landing`; merge, main-demo
rebuild and publication remain with the orchestrator.
