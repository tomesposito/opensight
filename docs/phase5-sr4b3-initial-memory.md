# Phase 5 SR4b3 — initial ingestion memory budgets

An actual 8 MiB browser transfer succeeded but its native ingestion attempt
failed. The same immutable application image reproduced the failure locally
with validation limits. Parsing and Parquet encoding succeeded under its existing
2 GiB allocation with a 512 MiB child heap, 1 GiB child RSS ceiling and 64 MiB
working/cache limits. The measured run used 37,367,322 accounted working bytes
and 668,622,848 peak child RSS bytes. This is evidence for a bounded configuration
correction, not proof that the AWS workflow is complete.

Add IAM/operator-authorized `tune-initial-budgets`, version one, bound to the
original bootstrap operation, activated application digest and epoch one. Its
strict input includes previous and target canonical budget SHA-256 digests.
Target values come only from the existing budget environment variables. Validate
owned schema, markers, active key, original bootstrap/activation receipts and the
two original active administrator identities; business resources may now exist.
Require open admission and PostgreSQL runtime lock support. Within the existing
control-row transaction, reject any held admission whose hold time has not
expired according to database time. This serializes with runtime admission and
publication. Existing queued/failed attempts retain their cleanup and retry work.

First execution requires budget version one, coordination revision one and an
exact previous digest. Only defaults working/cache bytes become 64 MiB, defaults
worker RSS becomes 1 GiB, and defaults/node child heap becomes 512 MiB; each must
be nondecreasing. All other fields, including tenant overrides, remain identical.
The target must match its supplied digest. Set budget version and coordination
revision to two atomically with an HMAC receipt and audit. An exact retry verifies
the committed version/configuration and returns the receipt. Changed arguments,
authority, epoch, admission, identities or configuration fail closed. Preserve
all durable records, entitlements, application image and credentials. Migration
replay accepts positive matching budget/configuration revisions without resetting
them. General release, arbitrary configuration mutation and D-25 maintenance
remain outside this command.

The private operator uses an external digest-only change record and existing
environment inputs, pinned administration artifact and saved-plan review. Keep
private configuration outside git and preserve the active application artifact.
No service, provisioned capacity, Lambda memory allocation or recurring wake is
added. The existing node working-byte cap permits one native attempt at a time.

Verify authority/input rejection before SQL; transaction rollback; held-admission
refusal and serialization; exact retry and changed configuration refusal; preserved
work/identities/epoch; and real 8 MiB parse/encode in the unchanged application
image. Run the root suite, focused PostgreSQL tests and infrastructure checks,
rebuild/capture the unchanged demo, then complete real AWS browser acceptance.
