# Phase 5 SR4b5 — pilot execution allowance

After the preflight fix, the real 8 MiB AWS ingestion attempt ended cleanly with
`EXECUTION_CANCELLED`; its Lambda duration was 11,046 ms and peak memory 884 MiB.
The ten-second validation execution allowance expires before native ingestion
finishes. Extend active execution to 30 seconds while keeping the existing 2 GiB
Lambda allocation, concurrency, row/byte quotas and database idle behavior.

Add private IAM/operator-authorized `extend-pilot-execution`, with strict version
one input, original bootstrap operation, expected epoch one, current application
digest, original activation digest, expected budget version (at least two), and
previous/target canonical budget digests. The target comes from existing budget
environment variables. Validate exact owned schema/markers, key, original
activation HMAC receipt and the two original active administrator identities;
business resources may exist. Require open admission and the installed runtime
lock privileges. The application digest must match the administering function's
environment; the original activation digest is independently verified against
the preserved SQL receipt. The private connection-repair record supplies this
provenance without relabeling the original activation.

Under the existing control-row lock, require matching expected budget and limits
revisions, exact previous configuration, and no unexpired held admission. Only
default/node `executionMs` may increase, each at most 90,000 ms; other fields are
identical. HTTP and worker platform deadlines remain the earlier bound. Advance
both revisions together, append an audit and HMAC receipt keyed by the preceding
version, and preserve all work, identities, entitlements and epoch. Exact retries
verify the committed target/revision; conflicting input or state fails closed.
This bounded pilot operation remains usable after the connection repair, while
bootstrap, activation and other initial commands remain closed.

The private operator binds the original activation and current application, reads
the version and digests from an external execution-change record, and verifies the
exact returned version. Deploy a separately tested administration image and only
the execution environment changes through the existing saved-plan checks. No new
service, allocation, schema, public endpoint, polling or automatic database wake.

Verify authority and strict input before SQL; original/current image separation;
held-admission refusal, rollback, exact retry and changed-field/ceiling denial.
Run the root suite and focused PostgreSQL checks; validate the slower native
8 MiB path, rebuild/capture the unchanged demo, and repeat AWS browser acceptance.
