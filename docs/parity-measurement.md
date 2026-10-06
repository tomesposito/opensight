# Parity measurement protocol

How OpenSight quantifies rendering fidelity against QuickSight reference
screenshots. Built for issue #42; harness is `@opensight/parity`
(`packages/parity`).

## What this measures — and what it does not

The harness produces **per-region pixel-difference fractions** between a
QuickSight reference screenshot and a demo capture, plus a hand-recorded
structural checklist. Scores are **change detectors, not fidelity grades**:
layouts, copy, data, and fonts legitimately differ between a QuickSight
product screenshot and the OpenSight demo, so absolute values are expected
to be high. The correct reading of a report is:

- compare the **same pairing** across baselines to judge whether a change
  moved fidelity;
- rank regions by diff fraction to name the biggest measured gaps;
- treat a region below the equivalent threshold (5%) as visually
  equivalent at this protocol.

Never present a single baseline's absolute score as "X% QuickSight
compatible". (Repo rule: no claiming parity we haven't measured —
`AGENTS.md` §5.)

## Pairings

| ID | QuickSight reference | Demo capture | Viewport | Theme | Fixture |
| -- | -------------------- | ------------ | -------- | ----- | ------- |
| `editor-classic` | `qs-editor-classic.jpg` | Author view, new empty analysis | 1440×935 | Light (demo default) | Offline demo, synthetic sales (BLAZE) |
| `editor-newlook` | `qs-editor-newlook.jpg` | Author view, new empty analysis | 1440×807 | Light (NEW LOOK light selected) | Offline demo, synthetic sales (BLAZE) |
| `q-generative` | `qs-q-generative.jpg` | Home dashboard with Ask-a-question | 1440×979 | Light (demo default) | Offline demo, local deterministic interpreter (no AI) |

**Viewport rule:** captures are taken at the reference's aspect ratio
(1440 wide, height chosen to match) so normalization is a pure scale with
no crop. If aspects ever differ by more than 15%, the run flags
`ASPECT_MISMATCH` and region scores are low-confidence — flagged, never
silently scored.

**Reference preparation (private):** QuickSight screenshots are AWS
product screenshots and MUST NEVER be committed to the public repo
(standing rule). They live in
`~/workspace/goals/opensight/hidden_files/lookfeel-references/`. The
harness reads PNG only (keeps the dependency set MIT-only: `pngjs` +
`@types/pngjs`); JPEG references are converted once with PIL:

```bash
python3 -c "
from PIL import Image
d = '~/workspace/goals/opensight/hidden_files/lookfeel-references/'
for f in ['qs-editor-classic.jpg','qs-editor-newlook.jpg','qs-q-generative.jpg']:
    Image.open(d+f).convert('RGB').save(d+f.replace('.jpg','.prep.png'))"
```

Only protocol docs, test fixtures (synthetic, generated in-memory), and
the baseline report go into the repo. Private reference pixels stay in
`hidden_files/`.

## Regions and exclusions

Regions are fractional rectangles (0..1) of the **reference** image, named
per pairing (header/toolbar, data panel, visuals panel, canvas,
properties panel, ask-q panel, build-for-me dialog — see the pairings
config for exact boxes). The capture is normalized to the reference
canvas first: uniform cover-fit scale (no aspect distortion), top-left
aligned, excess cropped from bottom/right. Scale, crop, and sizes are
recorded in every report for reproducibility.

**Named exclusions** are boxes skipped by the scorer, each with a reason:
letterbox bands baked into a reference, OS window chrome, and — the
important one — **intentional declared divergences** (e.g. the demo's
light brand header where QS has a dark navy header; the BLAZE badge where
QS shows SPICE). A divergence that is declared is not silently scored;
one that isn't declared shows up as diff.

**Structural checklist:** per pairing, a hand-recorded list of key
elements in the reference (present / absent in the demo, with a note).
The harness carries it; it does not compute it.

## Tolerance rule

A pixel differs when any RGB channel differs by more than **16** (0–255),
absorbing JPEG artifacts and antialiasing. Alpha is ignored (opaque
screenshots). A region is **equivalent** below **5%** diff fraction.

## Running it

The pairings config lives outside the repo (it holds absolute paths to
the private references):
`~/workspace/goals/opensight/hidden_files/parity-pairings-<date>.json`.

```bash
node packages/parity/dist/run.js \
  --config ~/workspace/goals/opensight/hidden_files/parity-pairings-2026-10-06.json \
  --out /tmp/parity-baseline
```

Writes `report.json` + `report.md`. Exit non-zero with a named
`PARITY_*` error on any broken input (fail-closed).

## Baselines

- `docs/parity-baseline-2026-10-06.md` / `.json` — first baseline
  (paths reduced to basenames; full local paths stay in `hidden_files/`).
  Re-run and commit a new dated baseline after visual-parity slices land;
  the top-gaps ranking tells the next sweep what to close first.
- `docs/parity-baseline-2026-10-06-issue-43.md` / `.json` — same-day
  rerun after always-visible empty wells. The suffix preserves the first
  baseline. Empty wells are present in both editor captures; assigned pills
  remain absent in these empty-analysis pairings. Pixel diffs increased; see
  the report's comparison rather than interpreting presence as pixel parity.
- `docs/parity-baseline-2026-10-06-issue-45.md` / `.json` — shared ASK Q
  side panel. The Home pairing now opens Q and submits `revenue by region`
  so the panel, preview and alternatives are visible. Reference pixels,
  regions, exclusions, tolerance and viewports are unchanged. This closes
  the structural panel gap; its pixel diff increased from 48.8% to 61.8%.
