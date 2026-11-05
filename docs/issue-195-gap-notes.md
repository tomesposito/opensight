# Issue #195 — imported tooltip field references

Bundle import resolves QuickSight tooltip field IDs through every field-well
wrapper in the visual. Visible well fields do not become extra query measures;
hidden well fields use their column names in the editable model. Extra measures
require an `opensightTooltipExtras` annotation, including its label and
aggregation. Unknown foreign references stay outside the executable model and
are named as retained/read-only by the existing import report. Untouched visual
JSON remains identical on export, including those references.

Explicit remapping keeps only tooltip extras that match local sales measures,
using case-insensitive names, and reports dropped extras in `unmappedFields`.
Hidden tooltip state keeps matching sales fields of either role; unmatched
hidden entries are discarded without requiring manual assignment. Compiler
tooltip semantics are unchanged. No dependencies or configuration were added.

The regression suite uses the real sanitized archive and synthetic bundles to
cover all imported sheets, reducer-driven remap/assignment, hidden-field names,
retained export data, OpenSight annotation round trips, deduplication, multiple
field-well shapes, and malformed tooltip validation. The J5 migration journey
now requires drawable chart paths after assigning region and revenue and
rejects unknown-column errors.

## Verification

The focused import/tooltip/round-trip/fixture run passed **103 tests / 0 failed /
0 skipped**, after strict TypeScript compilation. The new test file is picked
up by the web package's existing `test/*.test.mjs` glob.

The full root `npm test` run exited zero: **4,716 passed / 0 failed / 36
skipped**, comprising 4,684 passing Node tests and 32 passing Python SDK tests.
The web package passed **2,506 / 0 / 0** and the final conformance/docs suite
passed **102 / 0 / 0**. All 36 skips require live PostgreSQL (34 API cases and
two query-engine cases); there were no cancellations or TODOs. Chromium used
the installed headless shell, temporary files used `/tmp`, and local HTTP tests
ran with the required socket permissions. Full results are in
`/tmp/issue-195-npm-test.log`; package totals are in
`/tmp/issue-195-test-counts.json`.

The updated J5 journey passed **7 steps / 0 failed / 0 gaps**, including import,
remap and assignment, populated rendering, save, ZIP export, and reload. It used
a real local API with synthetic sales data and recorded zero browser errors,
external requests, or transport errors. Its results and screenshots are in
`/tmp/issue-195-j5/`; [the populated imported pie](images/imported-pie.png) is
retained with these notes.

## Visual review

The static demo was rebuilt from current source with
`node packages/web/scripts/build-demo.mjs`, using the fixtures and strict
TypeScript checks from verification. It remains a local fixture preview.
Comparison with `lookfeel-references/qs-author-light-flow.jpg` confirms the
established Data → Visuals/field wells → sheet flow. No editor chrome or layout
styles changed in this fix; visual fidelity is not measured.

The README hero GIF was regenerated with `capture-readme-tour.mjs`, the
repository adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`, and
its ffmpeg palette/assembly commands: **253 frames, zero browser errors and
zero external requests**. Static-demo captures are in `/tmp/issue-195-tour/`;
the author frame was also compared with the reference above.

The narrow imported pie card wraps its outside labels onto multiple lines.
This needs a separate visual follow-up; it does not prevent the populated
render required by #195. No remote issue was filed or phase-plan change made
under this build's no-network and no-design-edit constraints.
