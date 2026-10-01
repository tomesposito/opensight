# Issue #27: first-run verification and visual review

Built on `work/issue-27-first-run`, from `master` at `c6d45595`, using the issue
brief as the requested scope. `SOLUTION_DESIGN.md`, API authentication behavior
and dependency versions are unchanged. No dependencies, remote calls, deployments,
merge, push or issue closure were added. The runner owns publication.

## Acceptance and security

The startup screen replaces the dead session-error line with a product frame,
existing auth configuration, documentation links, retry and an explicit fixture
demo. It distinguishes `SECURITY_NOT_CONFIGURED`, rejected sessions and transport
or response failures, and times out slow session requests after ten seconds.

The demo uses the existing public sample persona and starts on Renderable Sales.
It never creates a hosted session. Entering it cancels session polling and removes
API clients from authoring, data preparation and connectors; the API option is
disabled and API/admin views also guard their render paths. Returning or reloading
requires a fresh session check. Configured users retain the original app, API
clients, role gates and initial fixture selection. Invitation handling remains
separate from demo opt-in. The existing static demo also benefits from the API
guard and the clearer “Dashboards & analyses” caption.

Fourteen added tests cover screen content, configuration names, session transport,
error classification, retry, timeout, focus/periodic recovery, revocation, cleanup,
stale responses, explicit demo entry/exit, static mode, configured author behavior,
and attempts to force API/admin views from demo mode. The API test confirms
missing auth, forged credentials, demo query flags and cookies cannot issue a
session; forged identity headers still return the existing `FORGED_PRINCIPAL`.
All tests use existing root workspace globs. Targeted verification passed
**24 / 0 / 0** (passed / failed / skipped).

## Browser and visual review

The checked-in [capture harness](../packages/web/scripts/capture-first-run.mjs)
starts real local Vite and fixture/configured API servers on ephemeral ports.
This machine's Chromium blocks direct loopback navigation, so the harness serves
a synthetic secure document origin and forwards its requests through Node to
those local servers. Every other HTTP request and all WebSockets are blocked.
This is a capture transport workaround, not an app or authentication change.

Browser acceptance passed with **zero page errors and zero external requests**.
It exercises missing security, offline and HTML proxy failures, 401 guidance,
retry, demo O answers, authoring/prep/connector modes, disabled hosted controls,
zero API requests while exploring samples, return/reload, a real configured
verifier, and revocation. Ten screenshots cover startup, expanded configuration,
mobile (390 px), sample dashboard, recovery states and the rebuilt static demo.
Every captured page passed the horizontal-overflow check.

The onboarding uses the existing navy/teal palette, with two clear next steps.
Mobile stacks the sample and setup sections and wraps long environment names.
The expanded configuration remains keyboard-accessible through native details.
The new sample banner stays present across application modes. This screen has
no previous QuickSight first-run reference; no fidelity claim is made.

The rebuilt static author view was compared with `docs/images/author.png` and
`qs-author-light-flow.jpg`: Data → Visuals → sheet order, dominant canvas,
docked Properties and navy menu chrome are retained. The notices and
“visual fidelity not measured” footer remain. This is a local static demo,
not a deployed server. No new user-visible regression was identified and no
external issue was filed under the no-network instruction.

The README links the [first-run guide](first-run.md) and includes the new startup
screenshot. Data-preparation and connector screenshots were recaptured for the
changed demo caption. The author, Blaze and embed images retain their matching
UI. The hero GIF was regenerated with the supplied `readme-gif.mjs` storyboard,
adapted to the current local artifact path and fixed hold-frame counts, then its
ffmpeg palette/assembly commands. It contains 53 frames with no browser errors.

Local evidence: `/tmp/issue-27-targeted.log`, `/tmp/issue-27-browser.log`,
`/tmp/issue-27-browser/`, `/tmp/issue-27-demo-build.log`,
`/tmp/issue-27-readme-gif.mjs`, `/tmp/issue-27-gif.log`, and
`/tmp/issue-27-gif-assembly.log`. The capture harness uses the existing screenshot
tool installation; it downloads no browser or package.

## Full verification

Root `npm test` exited **0** with **1,469 passed / 0 failed / 9 skipped**.
All skips are live PostgreSQL integration tests (seven API, two query engine)
because `DATABASE_URL` is not set. Strict TypeScript and package public-entry
checks run through the existing workspace commands.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 242 | 0 | 7 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 496 | 0 | 2 |
| Web | 495 | 0 | 0 |
| Root conformance | 3 | 0 | 0 |
| **Total** | **1,469** | **0** | **9** |

An earlier full invocation printed the same green totals, but its supervising
shell ended with a termination status before recording its exit file. The full
suite was repeated with an isolated subprocess group and durable exit recording;
that run returned 0. No runtime or test changes were needed between runs.
Evidence: `/tmp/issue-27-verified-tests.log` and
`/tmp/issue-27-verified-tests.exit`.

`npm run build:demo --workspace @opensight/web` also exited 0. `git diff --check`
passes. The final full run verifies implementation commit `46334786`; later
commits contain the capture harness, documentation, reviewed images and these
verification notes. All work is committed on the requested branch; merge,
publication and issue closure remain with the runner.
