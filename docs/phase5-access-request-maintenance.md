# Phase 5 — access-request maintenance

The #176/#177 release adds `h8_access_requests` to the registered inventory and
creates it through the frozen owner migration. The public request-access form
captures requests for manual review; it does not create an account or workspace.
Notifications require an explicitly configured recipient and mail transport.

[D-89](itd/D-89-access-request-maintenance.md) specifies the exact additive
inventory transition when future object-cleanup obligations remain. The
independent owner operation preserves both epochs and original schedules after
complete runtime drain. It registers the encrypted backup and object pins,
verifies every retained table, checks the migration receipt and exact retry,
then promotes matching runtime, frontend and edge artifacts before reopening.

The isolated PostgreSQL operator rehearsal passed **13 tests, 0 failed, 0
skipped**: 10 migration/control cases and 3 registry cases. The new cases cover
the old authoring inventory without the access table, same-epoch freeze and
reopen, exact cleanup preservation, operator CRUD and tenant denial, no runtime
DDL, and transactional rollback of the added table and receipt after a
preservation failure. Existing tests retain the earlier migration, rollback,
held-restore, authority-denial and recovery-history coverage.

The exact generated edge code also passed 44 tests in CloudFront's execution
engine, including marketing-origin POST/preflight, denial of neighboring
operator routes, exact `Metric-Dataset` forwarding and malformed references.
The unassociated probe was removed. These preflight results do not substitute
for post-deployment capture, hosted workflow acceptance and final read-back.

No application bytes, dependencies or UI styles change in this maintenance
slice. The release retains the marketing form's visual checks recorded in
[issue-176-gap-notes.md](issue-176-gap-notes.md). Production configuration and
operational evidence stay outside the repository.
