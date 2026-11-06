# Issue #196 — verification and visual capture limits

The build follows the dashboard generation design approved November 5, 2026.
No changes were made to `SOLUTION_DESIGN.md`, dependencies, or deployment.

## Browser and journey gap

J4 now drives author-side dashboard planning, revision, and a second plan with
an explicit credit-limited tail. Its fixture retains the existing revenue rows
and adds synthetic category/date columns needed by the pinned provider grammar.
The planned balance sequence is 10 → 6 after four delivered tiles, → 5 after a
revision, → 4 after the existing reader answer, → 3 after another author answer,
and → 0 after three delivered tiles in a four-question plan. The fourth tile is
credit-limited. The existing credit-limit screen now follows actual calls rather
than manually seeded usage.

In this environment, the hosted fixture started, but Chromium refused to launch:
`Hatch WebGL domain policy is required for browser startup` (exit 13). No browser
steps ran. J4 records this as `author-dashboard-generation` in its existing gap
bookkeeping and still fails the journey; it does not claim a successful answer
or replace the real API with browser mocks.

The static demo rebuild (`npm run build:demo --workspace @opensight/web`) passed.
The existing `capture-grounded-ask-o.mjs` screenshot tool fails at the same
browser launch. README Ask O images and the hero GIF therefore remain unchanged.
There is no new screenshot comparison or claim of measured visual fidelity.
The existing light/dark author references remain the visual review baseline.
The static demo is a local artifact, not a deployed server.

External issue filing was not attempted under this brief's no-network rule.
The supervisor can rerun J4 and the screenshot/tour tools in an environment with
the required browser policy and review the resulting captures before merging.

## Tests

API and web regression tests for this work are included in the existing root
`npm test` globs. They cover per-tile outcomes, delivery metering, field-security
concealment, post-I/O rechecks, layout, preparation threading, provenance
round-trips, atomic commit and Undo, definition-only replacement, title rules,
stale metric seeds, and generative-only/author-only UI gates.

The sandboxed Node test runner twice aborted with a native callback assertion.
Local test execution was retried outside the sandbox. The focused web regression run passed 41 tests with zero failures or skips.
Final root-suite results are reported in the delivery message; a browser startup failure does not count
as a passing journey or an allowed unit-test skip.
