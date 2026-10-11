# Phase 5 SR4a — initial ingress evidence

The ingress implementation follows the [frozen contract](phase5-sr4a-public-ingress.md).
It supplies the database-free authorizer, generated CloudFront viewer boundary,
separate Terraform root and private plan/apply/frontend operator. Application
activation and public site DNS are still gated; this is not a live application.

The exact Linux ARM64 candidate image was built from commit `7631145`, with digest
`sha256:d3455b67956a613228d695675a97c51c02ea3d378f7484b700d1f6a70e5401a8`.
Subsequent commits in this slice add documentation only.

Root `npm test` passed **2,433 / failed 0 / skipped 14 / cancelled 0** (2,447 total).
API: 449 passed / 12 live-PostgreSQL skips; bundle parser: 199; embedding SDK: 10;
O interpreter: 32; parity: 11; query engine: 504 passed / 2 live-PostgreSQL skips;
web: 1,210; root conformance: 18. Builds and tests ran without network access in
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
  path and duplicate Host. Compute utilization is 12–14 percent.
- A real authorizer invocation succeeds at 256 MiB, with 146 MiB maximum memory,
  585.78 ms handler duration and 8,378.24 ms initialization (8,965 ms billed).
  Its role and network have no database access.
- Direct origin startup without the edge credential returns 401. The default API
  endpoint returns 404 and its disable flag is verified through the AWS API.
- CloudWatch observation before ingress validation reports 60 of 60 minute
  samples at 0 ACU. No SQL probe was issued during this slice.

Distribution propagation and the active Free subscription are still being
verified. Live edge forwarding, frontend delivery, durable consumers, database
migration/initial activation, tester bootstrap and the real authentication/upload/
ingestion/query/isolation checks remain before public site DNS publication.
Private plans, state, account/domain inputs, scan detail and service evidence are
kept outside the public checkout.
