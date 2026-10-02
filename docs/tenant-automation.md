# H7: tenant automation and durable job ownership

Issue #36 implements hosted-architecture §8 H7 and the final HQ-13 decision.
One API process owns one scheduler. Multi-node scheduling remains H10.

## Contract

- Hosted refresh, report and alert jobs carry tenant, namespace and an active
  owning membership. Refresh targets are sources, prepared datasets or imported
  datasets; reports and alerts reference durable dashboards. Alert evaluation
  follows a successful refresh of the same dataset by the same owner.
- Recipients are active user IDs in the same tenant, resolved to verified
  membership email addresses at delivery. Each report is rendered as its
  recipient, including dataset and source RLS/CLS and folder/dashboard access.
  Alert messages likewise contain only the recipient's authorized metric.
  Owners must retain permission to execute the job. No administrator rendering
  identity or arbitrary external email address is substituted.
- Claiming a due occurrence and advancing its schedule is one transaction.
  Occurrences persist the due time, initiating user, owner, job version and
  authorization/policy/configuration revisions. Missed intervals coalesce;
  refresh intervals resume from completion on success or failure. Manual
  executions use the same queue and coalesce with an unfinished occurrence.
- Queue admission, execution, publication, rendering and delivery recheck the
  tenant, memberships, job version and recorded revisions. Changes cancel old
  work with a named error. Future occurrences acquire current permissions.
  Orphans are stopped. Retired jobs and their histories remain addressable only
  within the tenant and to their current owner or tenant administrator.
- A completed report or alert evaluation atomically creates one outbox entry
  per recipient. Delivery retries use bounded exponential backoff and an
  immutable tenant/job/occurrence/recipient dedupe key. Interrupted execution
  returns to the queue; interrupted delivery returns to pending with the same
  key. A successful send receipt is durable. Retries reauthorize before sending.
  SMTP receives a stable Message-ID; an SMTP acceptance followed by a crash
  before receipt commit can still duplicate mail. This is at-least-once delivery,
  not exactly-once SMTP. The stub transport honors dedupe keys, including an
  injected shared receipt set for restart tests.

## User removal

The operator's user-removal preview lists owned refresh/report/alert schedules
and eligible active replacement users. The browser presents an explicit choice:
**transfer schedules** to another user, or **stop schedules**. The deletion
request includes the preview fingerprint; changed ownership requires a fresh
preview. No selection is implied by opening the prompt.

Removal, ownership changes and cancellation of queued/running occurrences and
pending deliveries commit together under the tenant lock. Transfer affects
future work only, revalidates target and recipient permissions as the new owner,
and never transfers owner-private prepared data or source credentials. Existing
target references are retained; a replacement without access is refused.
Stop disables all owned jobs. The membership tombstone remains the H2 mechanism.
Removing a user with jobs without the choice returns `JOB_DISPOSITION_REQUIRED`.
Removed recipients cannot receive queued mail. Repeated completed removal is
idempotent.

## Storage, migration and surfaces

Private H7 tables use composite tenant/namespace keys and foreign keys. Only the
operator/membership pool accesses them; tenant HTTP methods require a genuine
`TenantContext`, membership admission and ownership checks. Tenant database roles
have no direct H7 table privileges.

An offline, frozen migration converts H1's disabled legacy `job` records into
H7 jobs and histories. It requires an explicit scope and default owner for
ownerless refresh/alert records. Report owners and email recipients must resolve
to active tenant memberships. The migration validates target access, preserves
original H1 records as evidence, is transactional and checksum-idempotent, and
never replays historical notifications. Unresolved owners, recipients or data
bindings fail closed. Hosted startup refuses unconverted legacy automation.

Tenant routes: `/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/runs`,
`/api/jobs/:id/deliveries`, `/api/job-recipients`, `/api/automation-status`.
Creation derives the owner from the verified session; updates require the job's
current version. Histories and recipients are tenant scoped. The hosted
automation page displays jobs, recipients and their run/delivery histories.

`PUT /api/jobs/:id` accepts `{ "expectedVersion": 0, "spec": ... }` for
creation (the current version for replacement). A report spec has `kind:
"report"`, `dashboardId`, `recipients` (user IDs), `enabled` and the existing
interval/daily/weekly `schedule`. A refresh spec instead has `kind: "refresh"`
and `target: { "kind": "source" | "prepared-dataset" | "dataset", "id": ... }`.
Alerts use `kind: "alert"` and the existing dataset/dashboard/visual/field,
dimensions and condition fields; they run after successful imported-dataset
refresh rather than a timer. `POST .../runs` with `{}` queues a manual occurrence;
GET returns history. DELETE with `expectedVersion` stops a job and retains history.

Hosted prepared execution settings now accept Blaze `intervalMinutes`. Updating
the setting and its owner schedule commits atomically. Switching to direct mode
stops that schedule. Saving or deleting its recipe invalidates queued work;
the next claim stops a schedule whose saved execution settings no longer match.
Manual Blaze refresh retains the existing shared cache admission/fencing gates.

For migrated stores, stop the API and run `npm run jobs:migrate -w @opensight/api`
after H1–H4 migration, with `OPENSIGHT_METADATA_DATABASE`, the existing hosted
configuration, and `OPENSIGHT_JOB_MIGRATION_CONFIG` pointing to a JSON file with
`tenantId`, `namespaceId`, and `defaultOwner`. The command acquires the API's
maintenance lock. It neither edits legacy files nor sends email. H1 records
remain the exact archived state/status/transition evidence; migrated occurrence
histories expose execution status, without old metric values or email bodies.

Operator routes: `/api/host/tenants/:tenant/users` and
`/api/host/tenants/:tenant/users/:user` (GET preview, DELETE disposition).
The `#operator-users` browser page uses an operator credential held only in
memory and the existing trusted same-origin boundary. This narrowly permits
browser membership administration; other operator operations retain their
backend-only rule. Operator inventory exposes ownership, not report contents.
The static demo continues to label automation as needing a hosted API.

## Verification gates

Tests cover fake-timer coalescing, restart/recovery, migration rollback and
idempotency, permission changes while queued/running/delivering, orphaned jobs,
tenant and owner isolation, recipient RLS/CLS, user transfer/stop races, failed
and interrupted mail, and stub dedupe after acceptance without receipt.
The full root suite also exercises live PostgreSQL. Browser verification uses
the real hosted API, durable database and real query/rendering paths with stub
mail and synthetic data, including both deletion choices and cross-tenant
history/recipient denial.
