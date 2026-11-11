# Issue #241 verification and visual notes

Implementation follows the run brief and the approved D-93 design package,
including all seven decided rules. Neither solution-design file was edited.
The separately hosted GitHub issue was not fetched: the run explicitly forbids
network access beyond npm install, so the issue contract reproduced in the
brief was used together with the full local design and four mockups.

The session request summary includes `requestedByEmail` in addition to the
specified tier/state/createdAt fields. The waiting copy must identify the
requesting admin even when another administrator opens billing. Operator
resolution takes the request ID so a stale screen cannot resolve a replacement
request. These are additive interface details, not changes to D-93 behavior.
No dependencies, flags, AWS calls, payment details, pricing changes or
subscription-linking workflow were added. The existing quota environment
settings are now usable without Stripe; their validation and values are
unchanged. Partial Stripe configuration still fails closed.

The static demo was rebuilt locally. Captures in `/tmp/issue-241-captures/`
cover paused request, paused waiting, trial billing, trial pending, declined,
operator queue, tenant detail and the rebuilt demo. Paused request/waiting and
the queue also have 390px captures. All requests outside the local capture
server were blocked; account/API payloads were synthetic. No page exceptions
or document horizontal overflow were observed.

Compared against mockups a–d, the implementation keeps the plan cards, required
copy, request/withdraw actions, retention hold and operator resolution controls.
It reuses the existing application/operator chrome and accessible radio inputs.
The non-waiting paused card retains the established retention-date explanation;
the waiting card has no deadline. Tier changes use an explicit confirmation
button after picking a different tier. The queue follows the written
oldest-first rule (the illustration itself shows dates in reverse order).
The visual review corrected the tenant detail's nullable-tier fallback so
trials are labeled Trial/Trial ended rather than Self-hosted.

The demo was compared with `docs/images/sample-dashboard.png`: the pinned
charts, navigation and sample-data notice remain intact. No hosted request
flow is simulated in the static demo. This is a local artifact, not a deployed
service; visual fidelity is not measured. README media were not regenerated,
as explicitly exempted by the design package §8 for this hosted-only change.
No new unresolved visual gap was identified and no GitHub write was made.

Focused verification passed 18 paid-request API tests and 21 billing/operator
UI tests. Coverage includes concurrent requests and tier changes, PostgreSQL
locking/introspection paths, mid-trial and paused grants, retention expiry and
restart, decline/re-request, stale resolution IDs, non-admin/cross-origin/scope
bypasses, atomic audit rollback, notification failure, exact email copy and
escaping, backup/erasure, Stripe-mode transition, and server-state UI refresh.
The initial restricted API run hit a Node native callback assertion at a local
HTTP listener. Offline HTTP/browser checks ran successfully with local process
execution permission and the installed Playwright Chromium. No external
service was contacted.

The first full run found a real integration regression: composing waiting-list
billing also exempted sessions for legacy tenants with no billing record from
API/egress admission. Resolution exemptions now require an actual trial/paid
record in waitlist mode; Stripe's existing boundary is preserved. The existing
egress suite verifies this correction. That run also hit the unchanged H4
worker timing ceiling (4.8 seconds against 3 seconds). The superseded run was
stopped before rebuilding; verification is repeated without concurrent capture
or build work, with no threshold relaxation or additional skips.
The focused egress/paid-request/containment rerun passed **51 / 0 / 0**;
the unchanged containment performance test passed without competing work.
The next complete run exposed one obsolete operator-test setup assumption:
no Stripe used to mean no billing schema. The list test now compares schema
before/after listing, preserving its original no-DDL-on-read assertion while
allowing the intended waitlist startup migration.

The final full root `npm test` completed with exit code **0**. It ran every
workspace plus the root conformance and site tests, using the installed local
Chromium via `OPENSIGHT_CHROMIUM`. Results were **5,068 passed / 0 failed /
36 skipped**, including the Python SDK's 32 passing tests. The Node runners
reported 5,036 passed, 36 skipped, zero cancelled and zero todo. All 36 skips
require live PostgreSQL (`DATABASE_URL` or the live TLS PostgreSQL setup);
no other test was skipped.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,294 | 0 | 34 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 619 | 0 | 2 |
| Web | 2,576 | 0 | 0 |
| Root conformance and site | 110 | 0 | 0 |
| **Total** | **5,068** | **0** | **36** |

The full local log is `/tmp/issue-241-root-verified.log`. The rebuilt static
demo and final captures were reviewed before this run. `git diff --check`
passed; the solution design, dependency manifests/lockfile and pricing files
are unchanged. All implementation and verification commits remain on
`work/issue-241-waiting-list`; no merge, push or deployment was performed.
