# Issue #160 verification and visual comparison

The build follows the supplied #160 brief and the settled #157 decisions: opt-in
promotion, unchanged source calculations, same-dataset governed metrics, and one
draft → published approval pattern. No solution-design changes, new dependency,
AWS operation or remote publication is part of this slice.

## API and permission checks

Calculation promotion uses the existing metric model/routes and expression
validator. Tests exercise local and hosted creation, explicit name conflicts,
editor proposals, reader denial, owner publication, retained source pipelines,
immutable provenance/audit, idempotent retries and restart persistence. Legacy
CreateColumns calculations are covered, including COUNT defaults for strings,
case-insensitive conflicts, explicit renaming of incompatible source names,
analysis parameter rejection and attempts to replace
an invalid source expression with a valid submitted expression. A routing
regression check preserves read/edit access to a metric whose ID happens to be
`promote-calc`.

Template checks cover local and hosted propose/publish/edit histories, pending
visibility, reader and foreign-owner bypass attempts, secondary input slots,
branches/output selection, missing/foreign/incompatible bindings, immutable copies,
create-only behavior and restart persistence. Existing metadata migration and
edge-contract tests cover the widened asset kind and generated ingress grammar.
The final focused API run reports **13 passed / 0 failed / 0 skipped**.

Web tests exercise both promotion entry points, reuse of the metric form, default
values, server conflicts, owner review/publication, required input binding,
failed-creation retention and explicit offline requirements. The root suite
includes these test files through the existing workspace scripts. The full root
suite runs with `TZ=UTC`, the configured local Postgres, and
`OPENSIGHT_CHROMIUM` pointing to the policy-configured temporary launcher. An
initial invocation without that browser setting could not start Chromium; the
corrected browser check passed all eight tests before restarting the full run.
The final root run passed **4,491 / 0 failed / 1 skipped**: 4,459 Node tests
plus 32 Python tests passed. The only skip is the separately configured live TLS
Postgres integration test; regular live Postgres tests ran. The command exited
zero. The complete log is `/tmp/issue160-full-final.log`.

## Browser acceptance

`packages/web/scripts/verify-promotions.mjs` drives Chromium, Vite and a real local
API using a disposable workspace and synthetic team/amount CSV. It adds and saves
a calculated prep column, opens its prefilled metric promotion form, confirms a
new name, saves a draft and publishes it. It then proposes a recipe template,
opens its step review, publishes it, binds the caller's uploaded input, and creates
an independently editable prepared dataset. Finally it opens the rebuilt static
demo and verifies that templates explicitly require an API and expose no fake
creation action. There are **zero page errors and zero external requests**.

Desktop captures use 1440px width and mobile captures use 390px. Assertions check
for document horizontal overflow. A new calculation action initially wrapped into
single characters on mobile; the calculation catalog now scrolls inside its
container, preserving readable actions. Template review uses the same bounded
horizontal catalog and vertically scrolling dialog. The existing prefilled
textarea/select label text requires prefix locators in the browser script; no
product behavior is substituted or mocked.

## Reference comparison and README media

Compared the rebuilt prep surface with the prior README prep image and the local
QuickSight `qs-2026/qs-data-prep-new.jpg` reference. The left transformation catalog,
dominant graph, bottom configuration/preview area and docked controls remain.
Promotion and shared-template actions sit in the document bar. The current brand
tokens remain in use. The metric promotion form reuses the existing definition
form; template review reuses the standard data dialog and table. No supplied
QuickSight promotion form reference exists, so no feature-specific visual parity
is claimed. Existing density, branding and chrome differences remain; visual
fidelity is unmeasured.

README media includes the refreshed prep screenshot, the calculation promotion
form, a new template approval screenshot and the refreshed hero tour. Data prep
appears in the existing tour, so the maintained `capture-readme-tour.mjs`
adaptation of `~/workspace/tools/screenshots/readme-gif.mjs` was rerun. Its 253
frames use the documented ffmpeg palette workflow at 960×600 and 10fps. The tour
reported zero browser errors. Capture uses the unchanged image-owned Chromium
WebGL policy through a temporary launcher; no machine policy is edited or checked
in. The static demo remains a local rendering preview, not a deployed server.

No unresolved issue-specific visual defect remains, so no new remote issue was
filed. Captures and logs are under `/tmp/issue160-*`.

## Conservative boundaries

- Only saved dataset calculations are promoted. Analysis-local calculations keep
  their current semantics and have no promotion action.
- Source calc expressions must bind to the dataset's final schema. Removed or
  renamed intermediate fields are not inlined or silently substituted.
- Template proposals come from the editor's own saved recipe. The recipe owner
  remains the template owner, with administrators also able to publish.
- Template definition editing is available through the API. The UI covers
  propose, inspect, approve and reuse; it does not add a second pipeline editor.
- Template inputs must be explicitly bound, using existing prep step restrictions.
  Template edits never change datasets previously created from them.
