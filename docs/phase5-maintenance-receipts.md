# Phase 5 — conditional maintenance receipts

Issue #133 fixes the first S3 receipt write after a registered migration or held
restore. The SQL transaction can already be committed when this write begins.
The invocation adapter normalizes AWS failures, and an absent key can return
AccessDenied to a role without bucket-listing permission. Reading first therefore
cannot reliably identify a receipt that needs creation.

The fixed runner attempts its existing encrypted `IfNoneMatch: *` write first.
If that attempt fails or loses its response, it reads the exact object once and
compares the committed result, plan, registry and backup identity. Only the boolean
`replayed` observation is excluded. An unreadable object or a mismatched receipt
fails closed; no evidence is overwritten. IAM and dependencies are unchanged.

The regression tests exercise `InvocationAws.call()` error normalization with
conditional S3 behavior, including absent-key AccessDenied, exact retries, lost
responses before and after commit, unreadable evidence, and conflicting fields.
PostgreSQL rehearsal also covers the currently deployed audit-v1 inventory gaining
workspace naming/login selections and AI warning records, preservation of retained
objects and data, rollback, restricted grants, and an isolated held restore.

This source fix does not activate a release. The AWS operator must verify the
merged release's attestation and artifacts, preserve the existing recovery registry,
freeze and drain admission, register a fresh encrypted snapshot, migrate and verify
its receipt, update the login-selection edge route, and promote the exact runtime
and frontend. Reopening and release completion require hosted acceptance checks.
Do not reuse the first-registry bootstrap or change a compatibility digest without
performing and verifying the matching migration.
