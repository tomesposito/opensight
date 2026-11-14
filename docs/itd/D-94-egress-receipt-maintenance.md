---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-11-14
labels: [itd]
---

## Purpose

Define the maintenance transition needed by the authorized latest-release deployment.

## Scope

The deployed ideas inventory to egress reservations and AI answer receipts,
including the job-delivery dead-letter constraint, using registered maintenance.

## Out of Scope

Restore, billing activation, Stripe mode changes, runtime configuration changes,
retention changes, queue redrive and arbitrary compatibility relabeling.

### ✅ ITD D-94 — How should the egress and AI receipt release preserve pending cleanup?

#### CONTEXT

The user authorized syncing and deploying the latest release on 2026-11-14.
The attested candidate adds three private tables and a delivery constraint value.
Its compatibility digest differs from the deployed ideas/analytics release.
D-92 permits only the previous named inventory transition.

#### THE PROBLEM

How can this additive transition preserve retained data and accepted cleanup obligations?

#### OPTIONS CONSIDERED

1. Wait until every cleanup obligation finishes, then use epoch advancement.
2. Reuse the prior transition or relabel compatibility without migration.
3. ✅ **Bind and rehearse this exact transition under the D-87 maintenance safeguards.**

#### REASONING

Option 1 may defer deployment indefinitely as ordinary activity schedules more
cleanup. Option 2 bypasses the inventory contract. Option 3 uses the user's
deployment authorization while retaining complete drain, registered backup,
transactional preservation, exact receipt replay and independent watchdog gates.
It accepts a bounded maintenance outage and requires fresh evidence before freeze.

#### IMPLICATIONS

The source inventory ends in `-ideas-v1`; the target adds
`-egress-reservations-v1-ai-receipts-v1`. Add `h8_egress_reservations`,
`ai_answer_receipts`, and `ai_answer_receipt_reservations`, initially empty.
Extend `h7_deliveries.state` to admit `dead` while preserving every existing row
and rejecting unknown states. Verify exact old/new constraint values and operator
CRUD, tenant denial and absence of runtime DDL privileges for the new tables.

Bind the owner plan to both release manifests, configuration, inventories,
independent epoch, cleanup rows and schedules. Require zero active work except
exact future dispatched unclaimed object-cleanup obligations; recheck before
freeze and reopening. Verify the cleanup execution/protection protocol is unchanged.
Preserve both epochs, schedules, deadlines, attempts, object versions and registry
history; advance only registry revision. Keep D-92's drain, backup, receipt,
watchdog, promotion and temporary-authority cleanup requirements.

Rehearse the actual old schema on PostgreSQL with retained rows and objects,
including success, receipt replay, preservation failure rollback, grant denial,
constraint checks and rejected pending-work/epoch drift. Pin tested operator bytes
before cloud mutation. Promote the exact attested runtime/frontend, verify hosted
acceptance and record the actual compatibility with the completed migration.
After reopening, failures close admission for forward reconciliation; do not
restore over new receipt, egress, job or customer writes. Billing and signup
configuration remain unchanged and Stripe remains in sandbox.


#### Verified correction during the held transition

The deployed access-request table also lacks `notify_claim_token` and
`notify_claim_expires_at`. Both are nullable text columns introduced by the
candidate initializer. The candidate preservation verifier does not normalize
these additions and correctly rolls back the migration. Before retrying, confirm
all held tables still exactly match the version-pinned registered backup.

The private registered-maintenance helper may normalize only these two absent
backup columns to null when comparing the upgraded access-request rows. Existing
columns and values remain exact; non-null additions, changed values, extra rows,
missing rows and all other drift must still fail. The unchanged attested runtime
is the deployment target. Rehearse the actual old column shape on PostgreSQL,
including successful migration/replay and rollback of both DDL and rows.

Bind the correction spec commit, tested helper hashes, old/new immutable runner
versions and test evidence into the active operation by compare-and-swap before
retrying. Keep the original operation ID, owner plan, external epoch, registered
backup/version/digest and migration plan unchanged. Require the same quiescent
phase, unchanged old runtime/configuration, zero admission and exact held-table
fingerprints. This is a recorded verifier correction; it does not waive or skip
preservation, widen runtime privileges, modify billing, or restore data.
