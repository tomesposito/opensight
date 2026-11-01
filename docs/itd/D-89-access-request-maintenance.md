---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-11-01
labels: [itd]
---

### ✅ ITD D-89 — How can access-request storage ship with pending cleanup?

#### CONTEXT

The operator requested the latest release, including the request-access form
from #176 and notification support from #177. The release adds one operator
table to the registered backup inventory. Production has future, dispatched
object-cleanup obligations whose retention periods must remain intact. D-87
preserves cleanup during a constraint upgrade but excludes inventory changes.

#### THE PROBLEM

Add access-request storage without invalidating accepted cleanup or treating an
inventory change as an ordinary compatible application release.

#### OPTIONS CONSIDERED

1. Wait for every cleanup to finish. Normal usage creates further obligations,
   so this can indefinitely delay the release.
2. Advance the epoch and rewrite cleanup events. Rejected: durable authority
   transfer requires a different protocol.
3. Extend the registered, fully drained same-epoch procedure for this exact
   additive table transition. Selected within the authorized deployment work.

#### REASONING

The release leaves cleanup dispatch, execution, collection and object protection
unchanged. The registered migration verifies all retained rows against its pinned
backup and creates an empty operator-only table. Complete invocation drain and
the operation lock exclude old executors while the schema changes. Preserving
both epochs retains the original events' authority.

#### IMPLICATIONS

- This exception covers only `audit-v1-workspace-v1-ai-warnings-v1-analytics-v1-billing-v1-authoring-v1`
  to that inventory plus `-access-requests-v1`, with the already-deployed governed
  constraints unchanged. Bind both names, current/target release, configuration,
  external epoch checksum and complete cleanup inventory checksum in the plan.
- Before first freeze require the old inventory. Permit only future, dispatched,
  unclaimed object-cleanup work, with the same deadlines, attempts, object
  references and exact schedules. Deny other work, changed authority and drift.
- Keep D-87's operation lock, zero admission, disabled mappings, hard-timeout
  drain, watchdog and registered encrypted backup with pinned objects. Advance
  registry revision while retaining epoch, history, tombstones, retired keys
  and fence high-water marks. This does not authorize restore.
- Verify the new inventory, empty `h8_access_requests` table, nullable
  `notified_at`, operator CRUD and tenant denial, and no runtime DDL. Require
  transactional preservation, exact migration receipt and idempotent retry.
  Rehearse rollback on preservation failure and the original cleanup envelope
  after reopening. Do not change the ordinary CI compatibility guard.
- Reopen only after matching runtime, frontend and edge promotion. Check capture
  through the public marketing origin and verify a synthetic submission is
  durable. Keep notification settings unchanged; capture works without SMTP.
  Once reopened, retain all submissions. Acceptance failure closes admission
  for forward reconciliation; it never restores over new requests or deletes
  them to satisfy an old migration receipt.
- Remove temporary operator authority after acceptance and final read-back.
