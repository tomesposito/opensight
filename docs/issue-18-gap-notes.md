# Issue #18 verification and visual review

Work is on `work/issue-18-branching`, based on master `6dcdc0c8` and the
approved spec commit `402ea742`. Implementation checkpoint commits cover model
validation, compilation and Blaze policy, editor/API behavior, portability,
documentation, differential execution, and refreshed demo assets.
`SOLUTION_DESIGN.md` is unchanged from that spec commit. No dependency, AWS call,
external network request, merge, push, deployment, publication, or issue closure
was part of the build. Browser captures depict a local static demo.

## Behavior and implementation decisions

Optional `from` reads an earlier step; omitted `from` retains the predecessor.
Optional `output` selects saved execution, while explicit preview `through`
takes precedence. All stages are validated and compiled, including non-output
branches, and prepared dataset references consume their selected output.
Blaze requirements inspect output ancestry, including join right-step references
and the selected outputs of prepared dependencies. Other advanced branches remain
bounded draft previews. Existing HTTP routes already validate and retain the full
pipeline, so no request-body or stage-metadata schema change was needed.

The spec leaves two small UI/counting choices implicit:

- The five-consumer cap counts distinct downstream steps. A join reading the
  same stage on its left and right is one consumer; both reference types count
  toward the cap when they lead to different steps.
- **Add branch** immediately appends a Select columns step retaining all columns
  of its chosen upstream stage and opens its editor. The output follows the
  documented default last step unless the author has pinned it with **Set as
  output**. The regular catalog appends after the last array step.

The Left input editor explicitly repairs dangling `from` references after a
move/deletion. Deleting the explicit output resets it to the new last step,
removing the property if no steps remain. Invalid pipelines disable hosted save
and suppress preview requests. A rejected sixth branch is not added, and its
named error remains visible. Import grants no source access. ZIP readers now
preserve named prep validation errors instead of wrapping them as invalid ZIPs.

## Browser and screenshot comparison

`TZ=UTC npm run build:demo --workspace @opensight/web` rebuilt
`packages/web/dist/opensight-demo.html`; the brief's `build-demo-shim.mjs` helper
refreshed the local goal artifact. Chromium blocked all HTTP requests and observed
zero requests and zero page errors. Browser checks covered branch creation,
resolved graph edges, independent stage schemas, output marker movement, real
`.qs` download/import, dangling-reference errors, disabled offline saves, and
390-pixel mobile layouts including a 128-character unbroken step name.
There was no page-wide horizontal overflow; the graph scrolls within its canvas.

`docs/images/data-prep.png` now shows one cleaned stage feeding summary and detail
branches, the selected Output marker, and the Left input editor. Compared with
the preceding README prep capture and issue #9's prep reference, the left
configuration dock, canvas styling, typography, and preview remain consistent.
The author regression capture retains Data → Visuals → sheet ordering, navy
chrome, and docked controls when compared with `qs-author-light-flow.jpg`.
That reference shows analysis authoring, not prep branching; visual fidelity
remains unmeasured. No new unresolved visual defect was identified.

The README hero uses the existing `~/workspace/tools/screenshots/readme-gif.mjs`
storyboard, adapted in `/tmp/issue18-readme-gif.mjs` to show branching and output
movement. Captured frames were held three times for readability and assembled
with the script's 10-fps ffmpeg palette workflow. The resulting GIF is 960×600,
16.2 seconds, and 162 frames. Every frame decoded successfully; Chromium loaded
and animated it, and a playback screenshot visibly contains both branches and
the Output marker. No unaffected feature screenshot needed replacement.

Temporary evidence: `/tmp/issue18-browser/` contains desktop/mobile, invalid
reference, long-name, author, and GIF playback captures, the downloaded bundle,
and browser check results. `/tmp/issue18-gif/` contains storyboard frames and
palette output. These are synthetic sample-schema captures with no live rows.
