# Issue #95 analyses slice — review gate and baseline verification

2026-10-13, branch `work/issue-95-analyses`. This checkpoint contains a
contract proposal and draft IDD D-39. **The analyses implementation is
blocked on product review**, as required by the run brief's scope §4 and
freeze Q5. The [slice document](headless-v1-analyses.md) names the five
questions and the exact resume boundary. No analysis endpoint or mutation
validation is claimed as implemented.

## Verification

Full root `npm test` exited 0: **2,646 passed / 0 failed / 18 skipped /
0 cancelled**. The slice document records per-suite counts. All skips
explicitly require live PostgreSQL (`DATABASE_URL` is unset).

The first sandboxed run was interrupted after existing tests failed to
open loopback listeners (`listen EPERM`). The complete elevated rerun
passed. The counts above describe the completed run, not a sum of attempts.
No test or implementation was changed to work around that restriction.

`npm run build:demo --workspace @opensight/web` exited 0 and rebuilt the
local static demo and embed artifacts. This is not a deployed server.
Runtime sources, dependency manifests, `SOLUTION_DESIGN.md` and
`docs/api/openapi-v1.yaml` match the master base (`84bcca41`). Document
links resolve locally and `git diff --check` passes. Nothing was merged
or pushed; there were no new dependencies or AWS calls.

## Offline capture and reference comparison

Reused the querying slice's offline capture script, fixed clock,
navigation states and reference pairings with output paths changed to
`.opensight/issue-95-analyses/`. Captured empty Author at 1440×935 and
1440×807, plus Home Q answering “revenue by region” at 1440×979.
Chromium completed all three with **0 page errors / 0 external requests**.

Each PNG is byte-identical to its previous querying-slice capture. The
reference comparisons retain the same regions, exclusions and tolerance
of 16; all pairings have matching aspect ratios.

| Reference pairing | Overall differing pixels |
| --- | ---: |
| Classic editor | 41.22% |
| New-look editor | 33.58% |
| Q generative | 44.66% |

These reference differences are unchanged. Existing gaps include empty
Author content versus populated reference visuals, branding, demo
disclosures, dock/gallery details and Q content, as recorded in the
[querying slice notes](issue-95-querying-gap-notes.md). No new user-visible
gap was introduced; no issue was filed or scheduled by this proposal.
No visual-parity claim is made and README media is unchanged.

Capture scripts, PNGs, pairings and machine-readable reports remain
ignored local artifacts under `.opensight/issue-95-analyses/`; no private
reference pixels or reference-derived images are committed.
