# Bounded pilot SR3 deployment

[D-71](itd/D-71-pilot-migration-release.md) covers the operator-authorized promotion
of an attested release whose contract digest differs from the previous deployment.
The normal private CI compatible-release workflow remains unchanged.

## Temporary maintenance runner

`packages/api/src/pilot-release-lambda.ts` accepts only `inspect`, `freeze`,
`migrate`, `verify`, and `reopen`. Its fixed environment contains a private plan
binding the operation, deployment, previous/target release, configuration digest,
expected epoch and expiry. IAM invocation and a numeric Lambda version bind the
operator to a specific packaged runner. There is no HTTP route or arbitrary SQL.

Build the API, then run `node ops/serverless/pilot-release-package.mjs <private-dir>`
and zip its two output files. Keep the plan, AWS identifiers, configuration, logs,
backup inventory and operational receipts outside the repository. Use a temporary
VPC function and dedicated role limited to the required secret references, exact
operation/epoch/backup objects, their encryption key and its own logs. If the S3
endpoint requires an exception, limit it to that temporary role and those exact
objects; restore the original policy afterward. No standing application role gains
new privileges through this bridge.

The operator controller verifies the GitHub attestation and every release artifact,
checks live configuration/image/alias/mapping drift and uses the existing conditional
`ci/operations/active.json` lock. Stop admission and drain the longest function timeout
plus ten seconds before advancing the independently stored epoch and SQL gate.
The runner refuses live work and artifact references; it fails rather than accepting
an inventory filtered by PostgreSQL row-level security. This pilot transition also
requires both managed S3 version inventories to be empty.

Register a completed encrypted Aurora snapshot, seven-day retention boundary,
key-version references, schema/authorization/audit digests and epoch linkage before
DDL. The snapshot is held evidence, not an approved restore. The runner installs
SR3's three additive execution tables and runtime grants in one transaction with its
operation receipt. Existing definitions, identities, gauges, object records and
fences must retain their inventory digests. Reopening requires the exact migrated
receipt, epoch, promoted phase and checked grants.

The operator promotes the unchanged public image/frontend, adds the worker's existing
SMTP references and arms the independent watchdog before reopening. Run the private
synthetic HTTPS/auth/upload/ingestion/refresh/query/isolation smoke checks. Commit the
actual image, frontend, configuration and compatibility baseline together by CAS,
then clear the lock and verify the normal private CI preflight. Any failure keeps
admission held; do not down-migrate, restore old authority or blindly redrive queues.

Remove the temporary function, role, log group and endpoint exception after
acceptance. Preserve the encrypted backup and private operation history. Expired
cleanup repair (#96), generic infrastructure/restore automation (#86), and live mail
fault drills (#85) remain separate work.

## Validation

The root suite ran in isolated Linux ARM64 with Node.js 24.21.0, PostgreSQL 16.15
and Chromium: **2,978 passed / 0 failed / 0 skipped / 0 cancelled**. The final
row-security guard was independently rerun with all five pilot tests, including
real PostgreSQL grants and denial checks: **5 passed / 0 failed / 0 skipped**.
Coverage includes expired/unbound/stale plans, live admission refusal, idempotent
receipts, backup binding, atomic migration failure and a held gate after failure.

The rebuilt single-file demo and its 1280×800 Home screenshot are byte-identical
to the preceding demo/reference capture. No UI code or README visuals changed in
this maintenance tooling phase. Static-demo validation
is separate from hosted acceptance.

## Deployment evidence

On 2026-10-15 the operator deployed public release
`8b2481b2b50fac6a3921d1c4e43789caa4cd0c03`, whose
[public build and artifact attestation succeeded](https://github.com/tomesposito/opensight/actions/runs/38742985166).
The completed encrypted snapshot was registered before the additive migration.
The SQL epoch advanced from 1 to 2. The migration verified all existing inventory
digests unchanged, then verified execution-table grants and tenant denial.

The exact image/frontend were promoted, worker SMTP references configured, and the
actual resulting configuration/compatibility record committed together. Public HTTPS,
MFA sign-in, direct upload, durable ingestion, refresh, expected aggregate query
results and namespace isolation passed. The existing private GitHub Actions preflight
completed successfully against this new baseline. Its run details remain private.

The first startup smoke encountered an ingress initialization timeout before reaching
the application request function. Admission was held. A bounded read-only startup
retry returned ready, then the complete hosted acceptance passed; no database rollback
or compatibility relabeling was used. General deploy readiness handling remains an
#86 follow-up; this pilot evidence does not establish cold-start latency bounds.

The owner browser displayed the explained quota error, including live/reserved/
metadata usage, pending cleanup and eligible reclamation language. The rejected
reservation did not transfer object bytes. Failed reservations can themselves retain
capacity under the existing protocol; no manual quota adjustment was performed.
The browser harness initially compared the API message against a UI string prefixed
with its error code. The captured live DOM/screenshot confirmed the explanation;
no additional reservation was issued merely to repeat that assertion.

The temporary function, role and log group were removed, the S3 endpoint policy
restored, and the operation lock cleared. Both source queues and the recovery DLQ
were empty; the work DLQ retained its original 34 messages. The independent encrypted
snapshot/backup registry remains held under its seven-day retention boundary and is
not an automatic restore target. Aurora's zero-capacity minimum and five-minute
idle pause configuration remain in place.

The owner workspace's old expired source definitions also exposed a catalog listing
failure, tracked separately for remote development in
[#98](https://github.com/tomesposito/opensight/issues/98). It does not authorize
clearing those definitions or bypassing #96's cleanup recovery contract. #91's
application deployment and hosted quota-explanation acceptance are complete.
