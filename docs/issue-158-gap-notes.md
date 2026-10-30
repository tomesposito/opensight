# Issue #158 verification and visual comparison

The contract is [Grounded, inspectable Ask O](grounded-ask-o.md), including the
run brief's correction of the unrelated D-56 citation. The final implementation
keeps the existing grammar, query/preview path and API generative route. Synonyms
are field metadata, with the local sales alias declared on the revenue field.
No dependency or configuration change is required.

## Behavioral verification

The interpreter suite passes **40 / 0 failed / 0 skipped**. It covers metadata
synonyms in measures, dimensions and filters, exact-name precedence, ambiguous
alternatives, deduplicated field grounding, count-rows, unmatched terms and
confidence, copied step values, and shared descriptions after edits. Reserved
aggregation words retain their existing meaning; quoted field names still work.

The focused O entry, grounding and side-panel tests pass **42 / 0 failed /
0 skipped**. Actual fixture results change from sum to average; removing filters
changes the prepared definition and executed rows. Edited visuals add through
`o-add` and validate. Alternatives and new questions reset edits. Invalid Top N,
unsupported calculations and incompatible visual groupings replace the preview
with named errors and disable adding. Removing the final dimension while Top N
is set fails closed with O_MISSING_DIMENSION rather than silently discarding
Top N; clearing Top N or choosing the KPI visual (which clears Top N) recovers,
while leaving visual selection explicit.
API-mode edits use the same query client without synthetic fallback.

## Static demo and references

`npm run build:demo --workspace @opensight/web` rebuilt the single-file demo and
embed entries. `capture-grounded-ask-o.mjs` checked Home and Author at 1440×1000,
dark Author chrome, and Author at 390×844, with external HTTP requests blocked.
All four checks passed with zero page errors, external requests, document
overflow or panel overflow. The new controls use 12px editor system typography.
The right dock and fixed Close control remain accessible as the answer scrolls.

Compared with the local `qs-q-generative.jpg` reference and the previous
`docs/images/q-side-panel.png`, the question → interpretation → preview → add
sequence and right-side dock remain intact. Grounding and step controls occupy
the existing panel above the preview. Their extra height requires scrolling on
small screens. Existing differences in branding, notices, canvas layout and
properties docking remain; no new issue-specific visual regression was found.
Visual fidelity remains unmeasured. The static demo is not a deployed server.

The README Ask O screenshot and hero tour were refreshed from the rebuilt demo.
The maintained adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`
shows the sales synonym, SUM→AVG editing and filter removal. Its 246 frames were
assembled with the documented ffmpeg palette workflow at 960×600 and 10fps;
the capture reported zero browser errors and external requests.

The uploaded-data screenshot was also refreshed through the real local API.
`verify-o-answer.mjs` was updated for current dataset-selection, connector and
save navigation. Its checks passed: 17 actual HTTP dataset queries, North 6 /
South 3 after CSV upload, January 9 after date grouping, add-to-analysis, explicit
source recovery after restarting its temporary API, and the offline demo.
There were zero page errors, external requests or hosted O requests.

Browser reports and captures are in `/tmp/issue158-captures/`, the tour frames
in `/tmp/issue158-tour/`, and focused logs in `/tmp/issue158-web-final-focused.log`.

## Changed-file inventory

- Contract and reporting: `docs/grounded-ask-o.md`, this gap note,
  `CHANGELOG.md`, `README.md`.
- Interpreter: `packages/o-interpreter/src/index.ts`,
  `packages/o-interpreter/test/parser.test.mjs`,
  `packages/o-interpreter/test/grounding.test.mjs`.
- Web: `packages/web/src/authoring.ts`, `packages/web/src/OEntry.tsx`,
  `packages/web/src/o-authoring.ts`, `packages/web/src/style.css`.
- Web tests: `packages/web/test/o-grounding.test.mjs`,
  `packages/web/test/o-grounding-steps.test.mjs`.
- Capture workflows: `packages/web/scripts/capture-grounded-ask-o.mjs`,
  `packages/web/scripts/capture-readme-tour.mjs`,
  `packages/web/scripts/verify-o-answer.mjs`.
- README imagery: `docs/images/q-side-panel.png`, `docs/images/o-answer.png`,
  `docs/images/opensight-tour.gif`.

All commits remain on `work/issue-158-grounded-ask-o`. No push, merge,
deployment, AWS call, dependency installation or `SOLUTION_DESIGN.md` edit
was performed by this run.
