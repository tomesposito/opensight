# Phase 5 SR4b6 — buffered request evidence

Implementation checkpoint: `b190465`. The real hosted POST query regression
failed on the old bridge with 409 instead of 200. Marking the validated buffered
request complete makes the native query return the expected total. A separate
explicit invocation abort still cancels work and completes cleanup. Focused
runtime composition checks passed **7 / 0 / 0**; operator checks passed
**9 / 0 / 0** and reject forged or incomplete image provenance chains.

Full root `npm test`, offline Linux ARM64: **2,458 passed / 0 failed / 18 skipped /
0 cancelled**, 2,476 total. All skips require live PostgreSQL.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 463 | 0 | 16 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 504 | 0 | 2 |
| Web | 1,210 | 0 | 0 |
| Root conformance | 29 | 0 | 0 |

A private PostgreSQL 16.15 integration probe passed **1 / 0 / 0** for exact 8 MiB
native ingestion, prepared-data refresh and aggregate query through separate
runtime SQL roles and invocation pools. The result was East=512, West=1,024.
Object transport verified checksum, length and exact version with a local test
transport; it does not substitute for AWS acceptance. The acceptance harness was
corrected to perform the required explicit Blaze refresh before querying a
file-backed aggregate recipe. That is existing product behavior.

Application image:
`sha256:db28697820316eb017ebff68e015e6234d24fbc2b645a6f1a96de8fe54a5c40e`.
All nine bounded runtime smoke cases passed. Registry scanning completed with
exactly the previously reviewed finding/package/version set: 8 high, 6 medium,
1 low. These findings remain; no new dependency or base image was introduced.

All nine hosted frontend files are byte-identical to SR4b5. The rebuilt demo
captured 251 frames with no page errors or external requests; 130 matched exactly.
The inspected author frame differs only in saved-time text, 158 pixels at
(150,97)–(172,107). No new UI gap or README media replacement is required. This
static capture is separate from hosted deployment acceptance.

The reviewed pilot plan changed application images and their release digest only;
the administration image, SQL state and budgets remain unchanged. A separate
ingress plan selected immutable request version six and the matching authorizer
image. The Free subscription remained active.

Real AWS browser acceptance passed all six gates: startup, password/TOTP tester
authentication, 8 MiB direct S3 transfer, asynchronous ingestion, query and tenant
isolation. The workflow included explicit prepared-data refresh and returned the
expected East=512, West=1,024 totals. Three concurrent catalog reads succeeded;
idle page observation produced zero API requests or page errors. Startup from
idle took 20,542 ms. Canonical HTTPS used a private resolver override for this
pre-DNS check; public DNS verification is the remaining cutover step.
