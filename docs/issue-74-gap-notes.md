# Issue #74 — Verification and visual comparison

The hosted Data contract repair preserves the #70 layout. `SOLUTION_DESIGN.md`
is unchanged; this work does not claim measured QuickSight visual parity.

`packages/web/scripts/capture-hosted-data.mjs` runs browser acceptance through
the real hosted handlers, existing SQLite/source/job fixtures and synthetic data.
It checks populated landing/search, transformed detail columns, Generate analysis,
duplicate, edit, schedule add/edit/remove, real refresh and versioned delete.
Nine checks passed with zero page errors and zero external HTTP requests. The
capture transport supplies a synthetic session and fresh admitted request contexts;
it does not test a hosted identity provider or deploy a server.

Raw hosted captures and the result record are in ignored
`.opensight/issue-74/browser/`. Compare `hosted-landing.png`, `hosted-detail.png`
and `hosted-refresh.png` with `qs-data-landing.jpg`,
`qs-data-dataset-detail.jpg` and `qs-data-dataset-refresh.jpg` in the existing
QuickSight reference set. Tabs, header actions, the columns/metadata arrangement,
and the schedule/history tables retain #70's structure. Hosted cache metrics,
refresh history and failure emails remain explicitly unavailable. The existing
OpenSight shell and spacing differ from the reference; this repair changes no
layout or styles. No new visual regression was observed.

The static demo was rebuilt with `npm run build:demo --workspace @opensight/web`.
The three README Data screenshots were re-captured at 1280×800:
`data-landing.png`, `data-sources.png` and `data-prep.png` each differ from the
previous committed capture by **0 pixels out of 1,024,000**. The README hero GIF
was regenerated from the rebuilt demo with the maintained `readme-gif-44.mjs`
variant of `~/workspace/tools/screenshots/readme-gif.mjs` and its documented
ffmpeg palette assembly. It captured 34 frames with zero page errors. Paths were
redirected in a temporary copy to this checkout's demo and `/tmp` artifacts.

The static demo remains an offline rendering preview. The hosted browser checks
use fixtures and are separate from the static demo screenshots.
