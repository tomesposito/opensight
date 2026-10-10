# Issue #83 — SR4a local validation evidence

The validation package implements
[the frozen contract](phase5-sr4a-packaging.md). Its operator workflow is in
[ops/serverless](../ops/serverless/README.md). This records local acceptance;
actual AWS networking, Aurora privileges/RLS, auto-pause/resume and teardown
still require the isolated cloud experiment. It is not a deployed public site.

## Tests and artifacts

On 2026-10-10, root `npm test` ran offline in the pinned Linux ARM64 Lambda base,
Node **24.21.0**: **2,241 passed / 0 failed / 12 skipped / 0 cancelled**,
2,253 total. Every skip is an existing live-Postgres integration test with
`DATABASE_URL` unset. The upstream issue #76 layout-export fix is included.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 342 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 502 | 0 | 2 |
| Web | 1,134 | 0 | 0 |
| Root conformance | 12 | 0 | 0 |

Both OpenTofu roots validate. All **5 mocked-provider tests pass**, checking the
0–2 ACU/five-minute pause settings, private network/DB, function caps, bootstrap
secret separation, pinned image, forbidden plaintext environment inputs and
restricted SMTP identity. Five operator tests cover private paths, immutable
invocation/mail ceilings, foreign-resource refusal, safe probe results, plan
regressions and an independently calculated synthetic SMTP signature fixture.

The production image is approximately **201 MiB**, ARM64, pinned at
`sha256:a9d4e7baa714166ba267f55dba04a294d1211e691c2bdb059e31624449e58520`.
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
revision. No new application layout gap was identified. Existing README media
remain representative; no hero GIF refresh is needed for this backend phase.
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
before public release. The isolated probe accepts only fixed synthetic tasks and
has no public input surface. SR2/SR3 durable storage and event execution, idle
embed implementation and SR4b public ingress/release automation remain gates.
