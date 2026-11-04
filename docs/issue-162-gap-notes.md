# Issue #162 — metric digest gap notes

## Shared destination resolution — 2026-11-04

Tom's issue comments 6617287095 (2026-11-03) and 6619715093 resolved the
previous question: build shared lists in #162, use the existing active workspace
identity registry, and compute one digest using the intersection of all remaining
recipients' row and column access. [D-90](idd/D-90-shared-metric-digests.md)
records that confirmed decision. `DIGEST_SHARED_DESTINATION_UNRESOLVED` is replaced
by explicit member selection and delivery-time recipient resolution.

Shared requests contain 1–50 unique member IDs, never email destinations.
Creation retains the owner/admin gate and creator execution authorization.
Delivery drops inactive or de-authorized recipients, fails closed when none
remain, ANDs effective row predicates, unions denied columns, withholds restricted
dimension drivers, and explicitly reports an empty intersection without values.
Single-node and serverless workers use one durable delivery and one shared
computation per period. Preview uses that same recipient resolution. SMTP
handoff rechecks the rendered audience/revision snapshot; later changes abort
instead of sending a stale message. Unsubscribe stops the whole shared list.

Slack connections do not exist in this workspace implementation. Slack delivery,
threshold/anomaly alerts and AI explanations remain outside this slice.

## Data-access boundary

Personal subscriptions grant no source or recipe access. Readers can subscribe when the
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
That verification covered the original personal slice; shared destinations are now implemented as described above.

## Shared implementation verification

The shared path preserves the owner-bound execution model. Recipient checks cover
active identity/membership, metric and dataset visibility, stored folder/dataset
grants, principal/group-resolved source plus dataset policies, and measure query
planning under each effective policy. Full per-recipient execution of another
owner's source is unavailable. Prepared sources must be unprotected under the
existing preparation rules. This limitation is explicit in `metric-digests.md`;
metadata visibility is not described as proof of independent source execution.

New integration cases exercise real contained queries, differing and disjoint
principal policies, source/dataset intersections, owner restrictions, denied date
and dimension columns, measure revocation, removed members, changed addresses,
all-recipient failure, retries, cancellation, unsubscribe, and serverless
receipts. The legacy grant-revocation test changes persisted grants in its
synthetic fixture because legacy dataset writes have no grant editor.

The hosted browser fixture now enrolls a second active member through the real
invitation and authentication flow. Acceptance covers the member picker, ID-only
shared creation, shared preview, desktop/mobile layouts and whole-list
unsubscribe in addition to the existing personal flow. UI tests also cover
honest member-list errors, the owner/admin refusal, and the empty-intersection
preview.

README tour inspection: `capture-readme-tour.mjs` shows the static Metrics tab's
API-required disclosure and never opens Subscribe. The shared picker cannot
appear in those frames. Per this build brief, README media is not refreshed.
No new dependency, AWS call, push or `SOLUTION_DESIGN.md` edit is included.

Final shared browser acceptance passed with zero page errors and zero external
requests at 1440px and 390px. Screenshot review caught member checkboxes wrapping
onto the preceding recipient's line; each member now occupies its own aligned
row with wrapping text. Final captures have no horizontal overflow. Compared
against the existing Data workspace and local
`lookfeel-references/qs-2026/qs-data-landing.jpg`: navigation, tabs and compact
controls are retained. No supplied shared-digest reference exists, so visual
fidelity remains unmeasured. No unresolved issue-specific visual defect remains;
no remote issue was filed under the no-network/no-push build constraint.

The static artifact was rebuilt with `packages/web/scripts/build-demo.mjs`, then
the brief's `build-demo-shim.mjs` regenerated its local goal-file copy. Chromium
verified the rebuilt static Metrics tab's API-required disclosure with zero
page errors, external requests or horizontal overflow. This is a local static
demo, not a deployed server. Logs and screenshots are under
`/tmp/issue162-shared-*`.

## Final shared-destination verification — 2026-11-04

The mandatory root command
`OPENSIGHT_CHROMIUM=/home/hatch/workspace/tools/chromium-wrapper.sh npm test`
exited **0**: **4,634 passed / 0 failed / 36 skipped / 0 cancelled**.
This comprises 4,602 passing Node tests plus 32 passing Python SDK tests.
All skips require live PostgreSQL: 35 need `DATABASE_URL` and one needs a
configured TLS PostgreSQL instance. The API suite passed 1,024 tests with 34
skips; query-engine passed 569 with 2 skips; web passed 2,470; final root
conformance/documentation checks passed 102.

Focused digest verification passed all 31 tests. A subsequent focused check
passed the added strict destination-shape and COUNT empty-intersection cases;
the full suite then verified those final cases again. The four digest UI tests
passed, and the final hosted browser acceptance and static-demo checks passed
with zero page errors or external requests. Final browser captures include the
corrected member-row layout at 1440px and 390px.

Full-suite evidence: `/tmp/issue162-shared-full-suite.log`. Browser evidence:
`/tmp/issue162-shared-browser.log`, `/tmp/issue162-shared-static-check.log` and
`/tmp/issue162-shared-captures/`. Demo build/shim logs use the same prefix.
Verification required local listener/worker/browser execution outside the
restricted sandbox; it used synthetic data, stub mail and no external requests.
