---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-15
labels: [itd]
---

### ✅ ITD D-80 — How do reviewed maintenance operations actually execute?

#### CONTEXT

D-34/D-78 supply compatible promotion and release requests. D-71 supplies a
bounded initial migration bridge. D-25/D-36 specify infrastructure and restore
contracts, but their templates currently contain comments instead of execution.
The operator is authorized to complete #86, including isolated cloud acceptance.

#### THE PROBLEM

Turn private review inputs into real saved-plan apply, migration and held restore
without allowing CI to approve itself, silently changing compatibility or
restoring obsolete security authority.

#### OPTIONS CONSIDERED

1. Continue ad hoc console operations and label evidence fixtures complete.
2. ✅ Generic bounded executors with immutable plans and independent authority.
3. Give routine code deployment unrestricted infrastructure/restore rights.

#### REASONING

Option 2 extends the existing independent approval and operation-record boundary.
Plan/apply, code promotion, maintenance and isolated restore have separate scopes.
An explicitly approved compatibility transition is a maintenance release; it is
not a rewrite of the compatible controller's baseline to make a check pass.

#### IMPLICATIONS

- Plans use the pinned OpenTofu/provider source, remote encrypted state and native
  lock. Bind exact source, configuration/backend bytes, provider/tool locks,
  lineage/serial, release and saved binary digest. Validity is at most 24 hours.
  Apply consumes only the reviewed bytes after independent approval, drift and
  state checks; it never generates a replacement apply plan. Protected resource
  destroy/replacement is denied. Uncertain/partial apply retains the operation.
- Store plans/receipts privately, encrypted outside Git. Workflow templates call
  real commands with short-lived separately scoped OIDC roles. Bootstrap/IAM trust
  remains independent; public PR workflows have no cloud trust or private token.
- Maintenance uses the same operation CAS/watchdog and complete invocation drain.
  Advance the independently held epoch before transactional SQL freeze; interruption
  stays closed. Migration requires exact checksums, registered backup and receipts;
  re-entry inspects committed state. Current object/reference inventory is
  preserved and pinned, rather than requiring an empty test installation.
- Backup registration binds encrypted metadata snapshot, object versions/digests,
  key versions, independent registry head and fence high-water marks. Every
  registry write is conditional and authoritative history never rolls back.
  A snapshot alone is not registered restore authority.
- Restore into a distinct isolated target with no ingress, queue consumers or
  SMTP permission. Verify the newest independent registry, key/object availability
  and immutable backup. Reconcile newer deletion/revocation evidence; missing
  history, keys or objects fails closed. Advance external epoch and SQL fences;
  suspend tenants, remove memberships, revoke sessions/invitations, cancel work
  and hold usage. Never blindly replay old events or reopen the target.
- A production restore cutover remains a separate explicit membership/security
  review and operation. The isolated restore executor cannot change production
  aliases, DNS, secrets or state history. If complete external lifecycle evidence
  is unavailable, it must leave recovery held rather than infer that no revocation
  occurred. Tests include later deletions, retired keys and stale worker epochs.
- Cloud acceptance uses temporary isolated resources with bounded execution and
  teardown. Preserve the approved low-cost production settings. Retention uses
  existing operator policy; tombstones/epoch/fence authority outlive all eligible
  backups and are excluded from disposable-plan cleanup.
