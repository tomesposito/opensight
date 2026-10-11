# Phase 5 SR2d / SR3a evidence

## Dispatch, storage and transfer checkpoint

The build is in progress. This checkpoint is not runtime activation or deployment.
No cloud resource, queue consumer, public route, DNS record or tester account is
created by these changes.

- Shared SQL authority preserves coordinator checks and serializes control
  operations with H1 tenant edits. New private dispatch/object migrations require
  frozen/drained maintenance and exact predecessor checksums; they grant no roles.
- A recovery acknowledgement precedes the branded business transaction. Intents,
  business effects and outbox entries commit atomically; lost dispatch receipts
  remain pending. Real one-time Scheduler requests have deterministic identity and
  exact conflict comparison. There is no polling dispatcher.
- Object capacity reservations share H8 namespace accounting with metadata writes.
  Exact-version binding converts capacity; retention, backup pins, ambiguous writes
  and uncertain deletion keep bytes charged. Publication is fenced before cleanup.
- Artifact writes allocate their exact cleanup key before the prewrite callback.
  Planned handles cannot be forged, redirected or reused after an uncertain PUT.
- The actual SDK signs Content-Length, Content-Type, SHA-256, If-None-Match and
  AES256 headers. Required constraints are not hoisted to URL query parameters.
  HEAD/GET require the exact version and headers, and GET has a streaming byte/hash
  ceiling. Browser/S3 CORS and live signing remain deployment acceptance work.
- Gateway control JSON is bounded at 1 MiB, event/response envelopes at 2 MiB,
  and headers at 16 KiB. Oversize input is rejected before SQL. Background private
  invocations allow 20 seconds for Aurora connection while retaining a 110-second
  work window and invocation-owned cleanup. HTTP startup behavior is unchanged.

On the pinned ARM64 Node 24 environment, TypeScript compilation passed. The focused
set passed **62 / failed 0 / skipped 0 / cancelled 0**. This includes real local
PostgreSQL with independent pools, forced RLS and restricted-role bypass attempts;
SQLite crash/ambiguity injection; native Parquet; actual SDK presigning without
network; an 8 MiB object; and corrupt/truncated/overflow streams. These local tests
are not evidence of deployed S3 CORS, Scheduler delivery or Aurora wake behavior.
The patched-parser and existing hosted-usage suites also passed **21 / failed 0 /
skipped 0 / cancelled 0**. The full root suite, runtime/client integration, UI capture and deployment proof
remain required before this phase is complete.

## Dependency acquisition

D-30's official SheetJS 0.20.3 archive is Apache-2.0 with no dependencies. Its
SHA-256 matches the recorded decision and npm locks SHA-512 integrity. The stale
0.18.5 parser and its unused transitive helpers are removed. Exact
`@aws-sdk/s3-request-presigner` 3.1149.0 is Apache-2.0; the only additional transitive
entry is tslib 2.8.1 (0BSD), covered by the existing approved exception. Other SDK
transitives were already present and did not change. Dependency acquisition used
npm; compilation and tests had no external network access. This does not resolve
or suppress the separately recorded runtime base-image findings.
