# Issue #162 — metric digest gap notes

## Product decision follow-up (issue comment draft)

The approved IDD allows shared email lists but requires authorization for every
recipient at delivery. Existing OpenSight identities represent personal
workspace members; there is no verified shared destination or membership
registry. Please decide the authoritative list-membership source and the rule
for combining recipients' different RLS views into one shared message. Until
then, the owner/admin gate is enforced and shared destinations fail with
`DIGEST_SHARED_DESTINATION_UNRESOLVED`. The run brief explicitly directs stopping
that part and shipping the remainder when a new product decision is required.
No issue comment was sent: this build permits no network access or publishing.

Slack connections do not exist in this workspace implementation. Slack delivery,
threshold/anomaly alerts and AI explanations remain outside this slice.

## Data-access boundary

Subscriptions grant no source or recipe access. Readers can subscribe when the
existing bound query path is executable as that reader. A published metric's
metadata visibility alone does not make another author's source or prepared
recipe executable. Protected source preparation remains refused by the existing
prep security policy; protected legacy dataset queries intersect dataset/source
RLS and CLS. These checks are covered by real contained-query tests.

## Visual verification

The static demo was rebuilt. The new browser acceptance script,
`packages/web/scripts/verify-metric-digests.mjs`, uses the real hosted test API,
built-in authentication, SQLite metadata and contained query workers, and blocks
all external requests. It covers subscribing from the existing Metrics tab,
drill-back preview, mobile layout and unsubscribe.

Initial direct Chromium startup failed because its required image-owned WebGL
policy was not supplied. The existing workspace launcher supplies that policy;
its checksum matched the installed file. Setting `OPENSIGHT_CHROMIUM` to that
launcher resolved startup without changing or bypassing the policy. The full
root suite uses the same setting.

The hosted browser check passed subscription creation, weekly default, a $450
current / $300 prior comparison, the two regional drivers, drill-back navigation,
390px mobile layout and unsubscribe. It recorded zero page errors and zero
external requests. Captures at 1440px and 390px have no document horizontal
overflow. Visual review caught unstyled controls on the drill-back page; it now
uses the existing compact Data-page styles, with long expressions wrapping.

Compared the new form and detail captures against the existing Data surface and
the local QuickSight `qs-2026/qs-data-landing.jpg` reference. The left navigation,
tabbed data workspace and standard dialog/card controls are retained. There is
no supplied metric-digest reference, so no feature-specific parity is claimed.
Existing branding and density differences remain; visual fidelity is unmeasured.

The README adds a synthetic hosted digest preview. Its hero tour is refreshed
from the final rebuilt static demo with the maintained
`packages/web/scripts/capture-readme-tour.mjs` adaptation of
`~/workspace/tools/screenshots/readme-gif.mjs`, using the documented ffmpeg
palette workflow: 253 frames at 960×600 and 10fps, with zero page errors or
external requests. The static demo is a local preview, not a
deployed server. No unresolved issue-specific visual defect remains; no remote
issue was filed. Captures and logs are under `/tmp/issue162-*`.

## Final verification after reboot — 2026-11-04

Resumed at `145cd208` with a clean working tree. All five implementation items
and the README media refresh were already checkpointed; the remaining work was
independent final verification. No further implementation changes were needed.

The full root command
`OPENSIGHT_CHROMIUM=/home/hatch/workspace/tools/chromium-wrapper.sh npm test`
exited successfully: **4,621 passed / 0 failed / 36 skipped**. This includes
4,589 passing Node tests and 32 passing Python SDK tests. All 36 skips require
live PostgreSQL; none were cancelled. The API suite contributed 1,013 passes
and 34 skips, the query-engine suite 569 passes and 2 skips, the web suite
2,468 passes, and the final root conformance/documentation checks 102 passes.
The separate focused digest run also passed all 20 tests.

The initial restricted-sandbox attempt could not start test loopback listeners
or contained workers and hit a Node runtime assertion. The successful run used
execution permissions for those local test processes and the existing Chromium
launcher. Verification used synthetic fixtures and stub transports.

The hosted browser acceptance check passed again with zero page errors and zero
external requests. Its desktop preview capture is byte-for-byte identical to
`docs/images/metric-digest-preview.png`; the 390px mobile capture has no
horizontal overflow. The static demo was rebuilt with
`node packages/web/scripts/build-demo.mjs` and checked in Chromium: its Metrics
tab retains the API-required disclosure, with no page errors, external requests
or horizontal overflow. The existing README media checkpoint remains current.

Full-suite output is `/tmp/issue162-final-test-unrestricted.log`; focused tests,
browser logs, the demo build log and captures are under `/tmp/issue162-*`.
Shared destinations remain deferred for the product decision described above.
