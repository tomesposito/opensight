# Issue #223 verification

## Deferred outbox eligibility

`AnalyticsStore.undeliveredEligible(limit, fallbackEnabled)` filters pending
events to active tenants with their matching namespace and enabled analytics
before ordering by creation time/event ID and applying the batch limit. The
saved override takes precedence over the draining instance's default; both the
integer default and limit are bound parameters. `undelivered(limit)` remains
the raw operator/test view of all pending rows.

The drain still checks admission and the off switch before each send. Disabled
or inactive tenants retain their pending events, which can be delivered after
re-enabling or resuming the tenant. No schema, dependency or UI changes.

## Verification

- API build and strict TypeScript compilation passed.
- Focused analytics tests: **29 passed / 0 failed / 0 skipped**. Coverage includes
  a 35-event disabled backlog, all inactive tenant states, re-enable/resume,
  defaults and overrides, ordering and limits, missing/crossed scope mappings,
  PostgreSQL parameter binding, and disable/suspend between selection and send.
- Root `TMPDIR=/tmp npm test` ran every workspace: **4,427 passed / 5 failed /
  36 skipped / 390 cancelled**, including the 32 Python SDK tests. All skips
  require live PostgreSQL. The run did not pass.
- One API containment load test measured maximum execution at 5,195 ms against
  its existing 3,000 ms limit. Its isolated rerun passed **1 / 0 / 0**, measuring
  1,432 ms. No containment code or thresholds were changed.
- Web browser checks failed during Chromium startup (`ECONNRESET`): **4 failed
  and 390 cancelled**. A direct offline startup attempt reported
  `Hatch WebGL domain policy is required for browser startup`.
- Root conformance and site tests, which the failed workspace command prevented
  `npm test` from reaching, ran separately: **103 passed / 0 failed / 0 skipped**.
  Across the workspace and conformance runs: **4,530 passed / 5 failed /
  36 skipped / 390 cancelled**.

Logs are local verification artifacts at `/tmp/opensight-223-*-test.log`;
workspace counts and a log copy are in `.opensight/issue-223-verification/`.
Live PostgreSQL execution of the new query was not verified.

## Static demo boundary

`npm run build:demo --workspace=@opensight/web` passed and rebuilt
`packages/web/dist/opensight-demo.html` and the embed entries.
Chromium's required startup policy prevents screenshots and reference comparison
in this environment. No UI change or measured visual-parity claim is made, and
README images are unchanged. The static demo is not a deployed server.

`SOLUTION_DESIGN.md` and dependency manifests are unchanged. All commits stay on
`work/issue-223-analytics-outbox-eligibility`; nothing is merged or pushed.
