# Phase 5 — issue 91 AWS diagnostic acceptance

Date: 2026-10-15. This records read-only production inspection and local validation.
The application changes are a review candidate, not a production deployment.

## Delivered behavior

- PostgreSQL inspection uses numbered parameters, verified TLS, an explicitly
  read-only repeatable-read transaction, bounded queries and connection disposal.
  SQLite is opened read-only and cannot create a missing database.
- The private IAM-only diagnostic Lambda can inspect the existing private Aurora
  database without starting the application or running schema migrations.
- Quota diagnostics share the collector's pin, operation, source, manifest and
  result protections; protected live objects are distinguished from pending cleanup.
- Authenticated upload errors expose a bounded numeric explanation through the
  hosted `Message` field. Object identifiers and arbitrary backend detail stay private.
- S3 HEAD absence is classified inside the invocation-owned AWS call, before
  provider errors are redacted. The previous ordering prevented the collector from
  recognizing its required deletion proof. Denied or ambiguous responses still fail.

## Live observations

Both explicitly selected pilot namespaces were inspected. Values below are bytes;
all private scope identifiers, object keys, event IDs and raw evidence are omitted.

| Scope | Metadata | Live gauge | Reserved gauge | Pending cleanup | Overdue objects | Gauge matches ledger |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Owner test workspace | 1,631 | 41,948,878 | 150,994,944 | 192,943,822 | 11 | Yes |
| Separate tester workspace | 2,864 | 8,399,558 | 0 | 8,399,558 | 23 | Yes |

Both limits are 268,435,456 bytes (256 MiB). Neither workspace had an active
reference/pin protection at inspection time. All 34 charged objects were retiring,
with 34 corresponding dispatched cleanup events whose execution windows had expired.
This is unfinished cleanup, not evidence that quota counters need recomputation.

Read-only S3 HEAD checks returned 404 for all 31 recorded exact versions. The three
unbound keys also returned 404; those checks do not substitute for a collector
transaction. A bounded DLQ inspection sampled 25 unique messages, all matching
expired cleanup events from these scopes. Temporary message visibility was restored;
no message was deleted or redriven. The queue's approximate visible count was 34.

The worker's IAM simulation allows GetObject, GetObjectVersion and DeleteObjectVersion
on the inspected object and ListBucket on its bucket. These policy checks do not
reconstruct historical execution, but provide no evidence that expanding IAM is
needed. Code inspection and regression tests identify the provider-error redaction
defect above; historical queue failures did not retain enough detail to attribute
every failure independently.

Each namespace needed one explicit retry after an initial bounded generic inspection
failure. Successful snapshots were obtained without automatic retries; the precise
cause of the first failures was not established.

The temporary function, dedicated role/inline policy and log group were removed and
their absence verified. The function reused the existing VPC configuration. Aurora
retains its 300-second auto-pause setting; CloudWatch reported minimum and maximum
capacity of zero for four consecutive one-minute periods after inspection. No
database polling was used to observe idle capacity.

## Verification and visual gap notes

Full root `npm test` in isolated Linux ARM64 with Node.js 24.21.0, PostgreSQL 16.15
and Chromium: **2,973 passed / 0 failed / 0 skipped / 0 cancelled**. The final
CA-file regression was also rerun on Linux: **12 passed / 0 failed / 0 skipped**.
Tests include real TLS PostgreSQL,
read-only/snapshot enforcement, refusal of an unrelated CA, connection cleanup,
namespace isolation, safe hosted errors, browser upload messages, the actual AWS
error wrapper, exact-version proof and duplicate quota release. No live AWS calls
are part of the build or test suite.

The demo was rebuilt. Before/after demo HTML and the 1280×800 Home screenshots are
byte-identical. The refreshed 251-frame README tour completed with no browser errors
or external network requests; Home and Author captures were visually inspected.
No new static-demo layout gap was found. The hosted error is covered by API and
component tests; the static demo is not evidence of a deployed hosted error.

## Remaining work

[Issue 96](https://github.com/tomesposito/opensight/issues/96) owns the separately
specified, audited recovery of expired cleanup obligations. Blind DLQ redrive would
terminalize expired events without completing reclamation. No counters, retention,
pins, object records or production application configuration were changed here.

Merge and deploy the reviewed application changes through the established private
release process. Production currently predates the SR3 migration work; do not bypass
the compatibility guard to deploy this branch. Issues 85 and 86 retain their migration
and release-executor handoffs. Issue 91 remains open pending merge/deployment and the
final hosted acceptance; the AWS diagnostic acceptance itself is complete.
