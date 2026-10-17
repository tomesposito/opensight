# Operator audit log

Every mutation on the operator plane appends one entry to the append-only
`h8_audit` table in the operator (membership) database. If something goes
wrong in the admin plane, this log records who did what, to which tenant or
subject, and when.

## Entry shape

| Column      | Meaning                                                        |
|-------------|----------------------------------------------------------------|
| `event_id`  | Random UUID, primary key                                       |
| `created_at`| ISO-8601 timestamp                                             |
| `actor`     | Operator identity; today always `deployment-operator` (the deployment has a single operator identity) |
| `action`    | Dotted action name, e.g. `tenant.suspended`                    |
| `tenant_id` | Target tenant, when the action targets one                     |
| `subject`   | Target subject identity (namespace, user, or email), when any  |
| `detail`    | Redacted JSON object with action-specific context              |

## What is audited

| Action | Source |
|---|---|
| `tenant.provisioned` | `MetadataOperator.provision` (trusted operator path) |
| `tenant.onboarded` | `HostedProvisioning.provision` (invitation onboarding) |
| `tenant.activated` | `MetadataOperator.activate` |
| `tenant.suspended` / `tenant.resumed` | `MetadataOperator.transition` |
| `tenant.deletion-requested` | `MetadataOperator.transition` (`delete`) |
| `tenant.deletion-finished` | `MetadataOperator.finishDeletion` |
| `tenant.deletion-completed` | `ReferenceMaintenance.deleteTenant` (artifacts purged) |
| `operation.checkpointed` | `MetadataOperator.checkpoint` |
| `membership.invited` | `HostedProvisioning.inviteMember` |
| `membership.removed` | `HostedProvisioning.removeMember` |
| `auth.key-rotated` | `activateAuthKey` (`rotate-auth-key`) |
| `backup.created` / `backup.restored-held` / `restore.memberships-reviewed` | `ReferenceMaintenance` |
| `retention.applied` | `ReferenceMaintenance.retain` |
| `reference.started` / `reference.migrated` / `reference.drained` | single-node lifecycle |
| `runtime.*`, `serverless.*`, `pilot.*` | runtime/serverless/pilot lifecycle |

Entries are written inside the mutation's own transaction: a rolled-back
mutation leaves no entry, and an idempotent replay of an already-applied
mutation appends nothing new.

## Secret redaction

The audit log never stores secret values. `redactAuditDetail` (in
`packages/api/src/operator-audit.ts`) replaces any detail field whose key
matches `token|secret|password|fingerprint|credential|totp|seal|signingkey|privatekey|authorization`
(case-insensitive) with `[redacted]`, recursively, and is safe on circular
structures. Callers additionally pass only identifiers by construction:

- invitation entries record the recipient email, role, and operation ID —
  the single-use token lives sealed in `h2_invitations` and in the mailed
  message only;
- key-rotation entries record the new key ID — never the signing key or its
  fingerprint.

## Reading the log

Operator-only. Over HTTP: `GET /api/host/audit` (requires the `Operator`
bearer key like every `/api/host` route) returns the newest 50 entries.
Programmatically: `readOperatorAudit(db, { limit })` with `1 <= limit <= 200`.

## Retention

`ReferenceMaintenance.retain(auditDays, …)` prunes entries older than the
configured audit retention; the pruning itself is audited
(`retention.applied`). Append-only within the retention window.
