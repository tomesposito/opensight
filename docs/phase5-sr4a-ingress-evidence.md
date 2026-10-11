# Phase 5 SR4a — initial ingress evidence

The ingress implementation follows the [frozen contract](phase5-sr4a-public-ingress.md).
It supplies the database-free authorizer, generated CloudFront viewer boundary,
separate Terraform root and private plan/apply/frontend operator. Application
activation and public site DNS are still gated; this is not a live application.

The exact Linux ARM64 candidate image was built from commit `7631145`, with digest
`sha256:d3455b67956a613228d695675a97c51c02ea3d378f7484b700d1f6a70e5401a8`.
Subsequent ingress-only corrections change Terraform/operator guards and test
fixtures; the application/authorizer image bytes remain unchanged.

Root `npm test` passed **2,436 / failed 0 / skipped 14 / cancelled 0** (2,450 total).
API: 451 passed / 12 live-PostgreSQL skips; bundle parser: 199; embedding SDK: 10;
O interpreter: 32; parity: 11; query engine: 504 passed / 2 live-PostgreSQL skips;
web: 1,210; root conformance: 19. Builds and tests ran without network access in
the pinned Node 24 Linux ARM64 build. Three Terraform mock tests also passed.

The production image passed read-only root, bounded temporary storage, packaged
module/assets, native success/failure/cancellation, worker reaping and temporary
cleanup checks under an unprivileged Linux identity. The private ECR scan reports
8 HIGH, 6 MEDIUM and 1 LOW package findings, unchanged from the preceding image.
The four distinct HIGH CVEs are assessed in the
[base-image review](phase5-sr4a-base-image-review.md). Remaining findings concern
system libxml2; the inspected Node, Lambda addon and DuckDB linkage does not load
that system library, and the application does not invoke its command-line tools.
No findings are suppressed or described as fixed.

The hosted frontend was rebuilt into a fresh output directory with on-demand mode
enabled. An older capture directory was correctly rejected because its reused
manifest listed itself. The private release selects only the fresh, validated
manifest. No browser/UI source changed in this phase.

The freshly rebuilt static demo completed the 251-frame browser tour with no
page errors or external requests. 148 frames matched the prior SR3b capture byte
for byte. Visual comparison of the authoring view found no new layout gap; focus
and capture timing account for visible differences in the inspected pair. This
does not establish measured QuickSight fidelity. Existing README images remain
current for the latest UI change, SR3b.

AWS validation so far:

- The saved ingress plan adds 35 resources, changes none and destroys none.
  Database, VPC and existing functions remain under their existing root.
- The request function has a published frozen version; publishing did not invoke it.
- The ACM certificate is issued. The authorizer is active with no VPC attachment.
- Seven AWS CloudFront function tests pass: accepted platform viewer address,
  forged peer, forged principal, forwarded address, query parameters, encoded
  path and duplicate Host. Compute utilization is 10–16 percent for these cases.
- A real authorizer invocation succeeds at 256 MiB, with 146 MiB maximum memory,
  585.78 ms handler duration and 8,378.24 ms initialization (8,965 ms billed).
  Its role and network have no database access.
- Direct origin startup without the edge credential returns 401. The default API
  endpoint returns 404 and its disable flag is verified through the AWS API.
- CloudWatch observation before ingress validation reports 60 of 60 minute
  samples at 0 ACU. No SQL probe was issued during this slice.

Distribution propagation completed. AWS rejected both the original WAF rules
and the IP-only retry that retained URI scope-down statements. The owned, empty
subscription-only stacks were safely removed. The corrected unscoped 600/5-minute
IP rule and global startup throttle of 0.1/second, burst two were accepted:
**ACTIVE/FREE**, with the exact distribution, WAF ACL and existing hosted zone
association verified. No paid edge tier was selected.

Live edge validation exposed two packaging problems that synthetic small events
had missed. URI-encoding byte counts exhausted function compute; native runtime
2.0 `Buffer.byteLength` preserves the shared UTF-8 budget and avoids that cost.
The managed policy also supplies CloudFront viewer-address metadata before the
function, so D-32 now discards that nonauthoritative field and uses only the
platform `event.viewer.ip`. Temporary fixed-category diagnostics were removed.

Seven real HTTPS cases pass: ordinary requests and a forged, ignored viewer-address
reach the frozen Lambda adapter's expected `UNTRUSTED_INGRESS` denial; forged peer,
forged user, forwarded address, query string and encoded path are refused by the
edge. No accepted request passes the frozen adapter to SQL. A real Chrome fetch
also reaches that expected adapter denial. The initial browser forwarding attempt
did not satisfy the check; a subsequent isolated attempt passed. Concurrent request
validation reproduces a transient origin 503, which must be addressed in the pilot
concurrency configuration before application acceptance. It is not counted as a
successful concurrent application test.

The private frontend manifest's eight files are uploaded and verified. HTTPS
frontend delivery succeeds, direct unauthenticated S3 access is denied, and the
real browser displays Connect with zero automatic API requests and zero page
errors. CloudWatch still reports all 60 observed minute samples at zero ACU.

Durable consumers, database migration/initial activation, tester bootstrap and the
real authentication/upload/ingestion/query/isolation checks remain before public
site DNS publication. The apex alias is still absent. Private plans, state,
account/domain inputs, scan detail and service evidence remain outside the public
checkout. [SR4b1](phase5-sr4b1-initial-activation.md) freezes the next activation slice.
