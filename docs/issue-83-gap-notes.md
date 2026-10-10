# Issue #83 — SR4a validation evidence

The validation package implements
[the frozen contract](phase5-sr4a-packaging.md). Its operator workflow is in
[ops/serverless](../ops/serverless/README.md). This records local acceptance and the initial
authorized isolated AWS experiment. Long-idle resume and the remaining SR5 gates
are still pending. It is not a deployed public site.

## Tests and artifacts

On 2026-10-10, root `npm test` ran offline in the pinned Linux ARM64 Lambda base,
Node **24.21.0**: **2,256 passed / 0 failed / 12 skipped / 0 cancelled**,
2,268 total. Every skip is an existing live-Postgres integration test with
`DATABASE_URL` unset. The upstream issue #76 layout-export, #77 reference-line and #78 bundle-import fixes are included.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 344 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 502 | 0 | 2 |
| Web | 1,145 | 0 | 0 |
| Root conformance | 14 | 0 | 0 |

Both OpenTofu roots validate. All **5 mocked-provider tests pass**, checking the
0–2 ACU/five-minute pause settings, private network/DB, function caps, bootstrap
secret separation, pinned image, forbidden plaintext environment inputs and
restricted SMTP identity. Seven operator tests cover private paths, immutable
invocation/mail ceilings, foreign-resource refusal, safe probe results, plan
regressions, empty backend/dependency staging and an independently calculated
synthetic SMTP signature fixture. Nine AWS-runtime tests include managed Aurora
credential ARNs, safe SQLSTATE errors and cancellation of a real stalled TLS
handshake without quarantining a clean runtime.

The production image is approximately **201 MiB**, ARM64, pinned at
`sha256:50acb0d77973e607e9490d9ddd5c94ec80c741af655243e8341e7a24e77f05c1`.
It was built from `61ce9e6` before the later #78 frontend import fix; its own full
root suite passed **2,250 / 0 / 12**. The merged-source counts above include six
additional upstream web tests. No public frontend is deployed by this experiment.
Nine image checks passed with no networking, an unprivileged user, read-only root
and a 512 MiB `/tmp`: filesystem limits, production modules, embed assets,
native success/failure/cancellation, worker reaping and temporary-file cleanup.
Tests/browser/source fixtures and private operator inputs are absent from runtime.
The runtime and hosted frontend receive separate file-hash manifests.

The first full run identified the missing test browser in the minimal base. A
pinned test-only Chromium was added; its AL2023 runtime libraries required the
correct Lambda environment marker. The full suite was then rerun successfully.
No test was disabled and no execution/resource threshold was increased.

OpenTofu 1.13.1's predecessor-registry lock shim rejects `-lockfile=readonly`
for the explicit Terraform-registry source. The harness instead requires the
provider lockfile to remain byte-identical after initialization; the installer
still checks existing pinned hashes. Both roots passed unchanged-lock setup.

## Isolated AWS evidence

The operator-authorized experiment uses a dedicated dual-stack VPC with two
private subnets, an S3 gateway endpoint and IPv6 egress. It has no NAT gateway,
interface endpoint, public database, public function URL or application ingress.
The private Aurora PostgreSQL 16.15 writer is bounded to 0–2 ACUs with a
five-minute auto-pause. Application maintenance remains frozen.

Measured on the pinned image and its immediately preceding build:

- Native DuckDB execution and child/temporary-file cleanup passed in Lambda.
- Secrets, SQS and Scheduler reached their configured IPv6 endpoints; S3 synthetic
  put/get/version-delete passed through the gateway endpoint. Both subnets were
  tested independently, then the original two-subnet configuration was restored.
- Three explicitly requested synthetic SMTP messages were accepted by SES,
  including independent checks from each subnet. Acceptance is transport evidence,
  not a claim about inbox placement or application job delivery.
- Bootstrap/migration succeeded from zero ACUs in 14.441 seconds. The operator
  role's required BYPASSRLS configuration worked on Aurora. Restricted tenant role,
  namespace isolation and attempted cross-scope access passed using rolled-back
  synthetic rows, including each subnet independently. Maintenance stayed frozen.
- The final pinned image repeated the database isolation probe from zero ACUs
  in 13.274 seconds; native work and maintenance startup passed again.
- CloudWatch showed Aurora returning to zero ACUs after SQL activity stopped;
  observation used service metrics and did not connect to PostgreSQL.
- A deliberately blocked TLS route returned `PROBE_TLS_TIMEOUT`; restoring the
  exact owned security-group rule allowed the next network probe to pass. There
  was no cleanup failure or quarantined runtime after the fix.
- IAM simulation confirmed request access to operator/tenant secrets and denial
  of bootstrap/SMTP secrets, plus probe-bucket prefix isolation. These are policy
  simulation results, not substitutes for live denied API-call tests.

The experiment exposed and fixed empty-state bootstrap handling, unknown Lambda
environment values during initial dependency creation, managed Aurora credential
ARN validation, implicit CLI retries and a stalled TLS handshake that previously
left cleanup pending. Regression tests cover those failures; the strict plan,
maintenance, tenant-role and invocation accounting checks were retained.

A final refreshed plan reported no infrastructure changes. All three functions
use the pinned image, both original subnets and frozen maintenance; none has a
function URL or event-source mapping.

Raw inventory, plans, logs, policy results, counters and address-bearing evidence
are private operator files outside Git. Synthetic object versions and one-shot
schedules were removed after the probes. The old image was retired only after
all functions had switched away from it. The infrastructure is retained for the
long-idle test; cleanup of the database/final snapshot has not yet been exercised.
Long-idle (>24-hour) resume, full SR5/SR6 application behavior, recovery/restore and
public release remain pending. The monthly budget alerts are notifications,
not a hard spending cap.

## Demo comparison

`npm run build:demo --workspace @opensight/web` rebuilt the static demo. A fresh
1280×800 Data landing capture was visually compared with the committed
`docs/images/data-landing.png`: the navigation, tabs, table, empty-state actions
and honest hosted-API notice retain the same layout. Typography/rasterization
and recent-page history differ between the current macOS browser capture and
the earlier reference capture; this is not a zero-pixel comparison. The original
external QuickSight capture scripts/reference files are not present on this
workstation, so no new QuickSight fidelity measurement is claimed.

This package changes no web UI source relative to the integrated upstream
revision. A second offline capture from the pinned Linux test image retained the
layout but lacked three existing Unicode icon glyphs (brand, dropdown and empty
state). This font-coverage dependency is tracked in [#87](https://github.com/tomesposito/opensight/issues/87)
for the SR3 browser slice. Existing README media remain representative of normal
desktop rendering; no hero GIF refresh is needed for this backend phase.
The rebuilt demo remains an offline preview, not a hosted server.

## Dependency and publication checks

New AWS client dependencies are Apache-2.0/MIT plus the explicitly approved
`tslib` 2.8.1 0BSD exception. The existing ECharts dependency retains its older
0BSD helper; it was not silently relicensed. The test browser/helper stay outside
the runtime image. The selected AWS base's OS inventory retains upstream
open-source notices; no SSPL, RSAL or Business Source component was identified.
The public RDS CA bundle is hash-pinned and contains no private key.

Gitleaks found no staged leaks. Additional checks exclude the operator's account,
email and domain values from staged content and verify the public CA hash.
The cross-platform index-path check passed. The generic heuristic scanner's
synthetic-ARN/public-certificate findings were inspected as noncredential data.
Private inputs, plans, state and evidence remain outside Git.

The dependency audit also reports existing high-severity advisories for `xlsx`
and build-time `source-map-js`; the added AWS clients introduce none. Triage those
before public release. ECR scanning of the deployed image also reports **8 high,
6 medium and 1 low** base-OS findings; curl, pcre2 and rpm package findings need
triage before public exposure. This is not a zero-vulnerability release.
The isolated probe accepts only fixed synthetic tasks and
has no public input surface. SR2/SR3 durable storage and event execution, idle
embed implementation and SR4b public ingress/release automation remain gates.
