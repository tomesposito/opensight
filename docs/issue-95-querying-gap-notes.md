# Issue #95 querying slice — verification and demo comparison

2026-10-13, branch `work/issue-95-querying`. This slice changes the hosted
API, its contract tests and documentation. Web, query-engine and
bundle-parser sources are identical to the branch's master base.

## Verification

Full root `npm test` exited 0: **2,646 passed / 0 failed / 18 skipped /
0 cancelled**. All skips require live PostgreSQL (`DATABASE_URL` unset).
The [slice document](headless-v1-querying.md#verification) records the
per-suite counts and OpenAPI validation.

`npm run build:demo --workspace @opensight/web` exited 0 and rebuilt the
single-file demo and embed artifacts. This is a local static artifact,
not a deployed server. No new dependencies, AWS calls, schema changes,
or edits to `SOLUTION_DESIGN.md` were needed. Nothing was merged or pushed.

## Offline capture and reference comparison

Captured empty Author at 1440×935 and 1440×807, and Home Q answering
“revenue by region” at 1440×979. Used the repository's public navigation
helper, a fixed clock, light theme and offline Chromium. All three
captures completed with **0 page errors / 0 external requests**.

The older toolbar capture script's geometry probe references an element
that the current UI no longer contains. A local capture script retained
its navigation, viewport and screenshot states while omitting that
obsolete geometry probe. Capture scripts, screenshots and machine-readable
reports are ignored local output under `.opensight/issue-95-querying/`.
No reference pixels or reference-derived images are committed.

The existing classic editor, new-look editor and Q reference pairings
were reused with unchanged regions, exclusions and 16-channel tolerance.
All three pairings matched aspect ratios.

| Reference pairing | Overall differing pixels |
| --- | ---: |
| Classic editor | 41.22% |
| New-look editor | 33.58% |
| Q generative | 44.66% |

These are reference differences, not a before/after regression measure
or a claim of visual parity. Existing differences include the empty
Author canvas versus populated reference visuals, product branding,
demo disclosures, dock/gallery details and Q content. The new-look
capture retains the left-to-right Data → Visuals → sheet → Properties
layout. This backend slice introduces no UI changes; README media is
unchanged and the existing look-and-feel work remains separate.

## Hosted visual-query gap

The optional analysis visual query alias cannot reuse the local
`SalesQuery`/`OrganizationService` route on the hosted tenant plane.
The [slice document](headless-v1-querying.md#deliberately-not-versioned-here)
records the missing hosted binding/access model for the analyses slice.
No authoring, sharing or generative-query semantics are invented here.
