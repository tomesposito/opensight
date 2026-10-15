# Issue #85 — SR3 non-AWS implementation evidence

The [SR3 handoff](phase5-sr3-background.md) maps checkboxes 1–6 to the frozen
D-24 contract, implementation, tests and outstanding cloud evidence. Work is
confined to `work/issue-85-sr3`, based on `origin/master` at `39627db4`. The
contract was committed separately before code. `SOLUTION_DESIGN.md` and package
dependencies are unchanged. No branch was pushed or merged.

## Local verification

Verification uses Linux x86_64 and Node 24.20.0 in the local workspace. Native
worker tests run with the local process permissions required by containment.
They make no AWS calls. Root `npm test` on implementation checkpoint `7d068a62`
exited **0** on 2026-10-12: **2,514 passed / 0 failed / 18 skipped / 0 cancelled**,
2,532 total. All eighteen skips require an unavailable live PostgreSQL database
(`DATABASE_URL is not set`). No skip or test threshold was relaxed.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 498 | 0 | 16 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 504 | 0 | 2 |
| Web | 1,214 | 0 | 0 |
| Root conformance | 46 | 0 | 0 |

The complete log is `/tmp/opensight-sr3-root-complete.log`. This is a complete
rerun after an earlier process terminated with exit 143; partial results from
that process are not counted. The final run includes every code/test checkpoint.
Whitespace and credential-pattern checks passed, and no dependency was added.

Fault injection covers recovery-arm rejection, transaction rollback, lost commit
receipts, lost queue/send receipts, lost completion/outbox receipts, duplicate and
late events, stale fences, cancellation, terminal retry exhaustion, continued
refresh scheduling after terminal failure, ambiguous SMTP acceptance and bounded
operator replay. A real renderer/native worker demonstrates owner versus recipient
RLS results and CLS denial. SMTP protocol tests use injected sockets and assert
TLS, IPv6, no DATA after authorization failure, lost DATA acknowledgement and
successful DATA followed by failed QUIT. No real email is sent.

The local broker model verifies the source-bound single-record response and
configured redrive policy. Static Terraform tests check the existing work/recovery
queues, three DLQs, retention, visibility and partial-batch settings. Terraform
is not installed in this workspace; no `init`, `validate`, plan or apply ran.
Actual AWS routing, IAM, queue behavior and SES connectivity remain cloud gates.

## Static demo comparison

After root tests, `npm run build:demo --workspace=@opensight/web` exited 0,
rebuilding fixtures, checking TypeScript and rebuilding the standalone demo plus
all embed entries. `packages/web/dist/opensight-demo.html` contains 785 bundled
modules and 2,124,973 bytes. The offline dashboard, builder and
automation views were captured at 1280×800 with external HTTP(S) requests blocked.
All three PNGs are byte-identical to captures from the preserved pre-build HTML:
zero changed pixels. All six captures reported zero page errors and zero external
requests. The rebuilt captures were also visually inspected; no new visible gap
was found. The generated HTML itself is not byte-identical, so the comparison is
specifically of these rendered views.

Local evidence is `/tmp/sr3-demo-final-build.log`, `/tmp/sr3-before*/landing.png`
and `/tmp/sr3-final*/landing.png`. This is a static preview, not a deployed server;
QuickSight visual fidelity remains unmeasured.

No product UI source changed in this slice. The existing README GIF and feature
images therefore remain tied to the latest UI phase. The automation preview
continues to state that background jobs and notifications need a hosted API.

## Remaining acceptance

Tom owns real SQS/Scheduler/Secrets/SES reachability, service-metric alarms,
source/IAM/PassRole and private replay-role wiring, IPv6/DNS/TLS checks in each
subnet/AZ, deployment/migration/mapping activation, WAF/IP allowlisting and resource
or cost decisions. The implementation does not establish any of that evidence.
No AWS call, provisioning, spending, private repository creation or live workflow
activation was performed.

## SR3/SR4 cloud completion comparison (2026-10-15)

Rebuilt the static demo and compared its Home page with the exact published
`a27a5bd` release demo at 1280 × 800 in the same Chromium environment. The two
PNG files have identical SHA-256 digests; no visible layout change was introduced.
This phase changes private deployment/acceptance tooling and the hosted SMTP
capability response, not demo UI. Existing README media remains current.
This is a regression comparison, not a new QuickSight fidelity measurement.
