# Phase 5 SR4b1 — initial activation evidence

Status on October 11, 2026: the pilot infrastructure and initial tester workspaces
are activated internally. **Apex DNS is not published.** The database resumed
successfully after nearly 20 hours at zero ACU; the greater-than-24-hour measurement
is deferred follow-up work. Real HTTPS startup, owner authentication and three
concurrent reads passed. The first upload reservation exposed a PostgreSQL row-lock
privilege failure before accepting a file; [SR4b2](phase5-sr4b2-runtime-row-locks.md)
corrects it. Upload, ingestion, query and isolation acceptance still gate DNS.

## Implemented and verified locally

The private administration entrypoint composes migration, initial role preparation,
two independent tester workspaces and epoch-one admission. It validates the
operator and strict input before constructing SQL. Credential-bound HMAC receipts
make exact bootstrap retries idempotent; changed input, populated/foreign schema,
wrong keys, later epochs and reopening after maintenance fail closed. Role/schema
changes roll back together. Request and worker roles cannot change control state.

The Terraform pilot profile adds work/recovery queues, DLQs, Scheduler custody,
exact-origin object CORS and bounded workers. Separate dependency/runtime/consumer
stages preserve the validation resources and keep consumers disabled until the
activation receipt. Runtime concurrency is four requests, one administration and
two workers per queue; the old synthetic probe is disabled at runtime promotion.
The ingress authorizer supports the selected four-slot pilot cap. No provisioned
capacity or recurring database wakeup is added. Legacy cleanup reads AWS cluster
tags and refuses promoted deployments even if local validation inputs are stale.

The promotion operator binds saved plans to source, private configuration, account,
deployment and versioned remote state, with a one-hour expiry. It refuses deletion,
replacement and the documented cost/security regressions. Private credentials are
generated once outside the checkout; no onboarding email is sent. See the
[operator runbook](../ops/serverless/pilot-README.md).

## Checks

Full root `npm test` ran offline in the pinned Linux ARM64 build at implementation
checkpoint `d4bf809`: **2,446 passed / 0 failed / 16 skipped / 0 cancelled**,
2,462 total. All skips are live-PostgreSQL-only tests.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 456 | 0 | 14 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 504 | 0 | 2 |
| Web | 1,210 | 0 | 0 |
| Root conformance | 24 | 0 | 0 |

Focused private-runtime/initial-setup tests also ran against local PostgreSQL 16.15:
**12 passed / 0 failed / 0 skipped**. This includes real concurrent bootstrap
retries, non-owner denial, FORCE RLS owner visibility and transactional rollback
between the two role-cap changes. The managed-Aurora initial role preparation subsequently passed during activation.

OpenTofu mock checks: validation/pilot **10 passed / 0 failed**; ingress
**5 passed / 0 failed**. These cover stages, queue limits, worker/source bindings,
master/SMTP secret exclusion, version-specific deletion, Scheduler scope, CORS
and authorizer caps. Staged secret and cross-platform path checks passed.

The final immutable runtime candidate is
`sha256:d1ecc98ff22d07ad58fd7e1e630e0edf7b72e02081cc67c43ff37a69fddeb6c3`.
It passed all nine runtime smoke cases: read-only root, bounded temporary storage,
production imports, embed assets, native success/failure/cancellation, worker
reaping and temporary cleanup. The uploaded candidate is 198.65 MiB compressed.
Its completed registry scan reports eight HIGH, six MEDIUM and one LOW finding,
with the identical finding/package/version set as the prior reviewed image.
The [base-image reachability review](phase5-sr4a-base-image-review.md) still applies;
these findings are not claimed fixed or absent.

The hosted frontend manifest is byte-identical to SR4a. The rebuilt demo tour
completed 251 frames with zero page errors and external requests. Of 257 PNGs,
159 match the prior capture byte for byte. Inspected differences are saved-time
text, focus animation and a transient save toast; four feature captures match
exactly. No new product layout gap was found. README media remains current with
the last UI phase. Visual fidelity against QuickSight remains unmeasured.

## Remaining cloud acceptance

Dependency/runtime/consumer plans and private migration/bootstrap/activation have
completed. Initial HTTPS startup, authentication and concurrent reads passed.
Apply the separately tested SR4b2 administration repair, then repeat the complete
browser upload/ingestion/query/isolation workflow, close clients and observe zero
ACU. Only then record release-bound acceptance and apply apex DNS. General D-25
CI rollout, drain and rollback remain separate work.
