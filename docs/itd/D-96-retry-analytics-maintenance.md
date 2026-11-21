# D-96 — Retry counters and analytics quarantine maintenance ✅

**Type:** ITD. **Date:** 2026-11-21.

## CONTEXT

The owner authorized completion of AWS/GitHub work followed by deployment of the
latest release. The deployed serverless inventory already includes egress and AI
receipts. The candidate adds two delivery retry counters and analytics quarantine.
Its conservative compatibility digest also changes for newer connector, stored
materialization and artifact-sample contracts.

## THE PROBLEM

The registered preservation verifier must recognize the precise additive column
transition while retaining existing rows, artifacts, cleanup and recovery history.

## OPTIONS CONSIDERED

1. Relabel compatibility or run startup DDL without registered maintenance.
2. ✅ Rehearse and execute this exact transition under the D-87/D-94 safeguards.
3. Defer the authorized deployment.

## REASONING

The change requires a registered backup and checked transaction. The table
inventory is unchanged. Normalize only the documented added fields when comparing
an upgraded table to the immutable snapshot; all existing fields remain exact.

## IMPLICATIONS

- Add `h7_deliveries.total_attempts` and `retry_sequences`: non-null integers,
  default zero, checked nonnegative. Backfill total attempts from the existing
  attempts value; retry sequences start at zero. Preserve pre-existing counters
  exactly when present. Add nullable text `analytics_events.quarantine_reason`,
  initially null. No other data or schema changes are admitted by this transition.
- Registered migration normalization adds only absent counters to the baseline:
  total attempts equals attempts and retry sequences equals zero. The existing
  analytics normalization already handles the nullable quarantine field. Reject
  changed or unexpected values, rows, columns, defaults, checks or grants.
- Bind both manifests, configuration and tested helper hashes to the owner plan.
  Preserve existing recovery registry history and the external epoch. Permit only
  the exact future, dispatched, unclaimed object-cleanup obligations validated by
  D-94; preserve their epochs, schedules, deadlines, attempts and object versions.
- Require zero admitted/in-flight work, disabled queue mappings, zero runtime
  concurrency, the full drain interval, independent operation lock/watchdog,
  registered snapshot/version/digest and transactional preservation before DDL.
  Rehearse actual old PostgreSQL shapes with nonzero retained retry attempts,
  migration/replay, injected preservation failure rollback and runtime grant denial.
- Change only the independently specified D-95 SMTP sender configuration during
  the held operation; record before/after fingerprints, unchanged other runtime
  values and exact restricted IAM policy. Preserve billing and sandbox settings.
- Promote the exact attested image/frontend and reviewed edge routes, validate
  hosted acceptance and static CSP, then commit the actual compatibility and
  configuration evidence. After reopening, any failure closes admission for
  forward reconciliation; do not restore over new writes. Remove temporary
  authority and the watchdog only after independent readback succeeds.
