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
| `actor`     | `deployment-operator` for operator actions; delegating member userId for hosted v1 calls |
| `action`    | Operator action name (e.g. `tenant.suspended`) or v1 operationId |
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
| `tenant.deletion-completed` | `ReferenceMaintenance.deleteTenant` (stores verified; retained under D-84; no duplicate on retry) |
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
mutation appends nothing new. The owner migration runs `initializeAudit`;
runtime append/read paths do no DDL and require the migrated schema.

Issue #330 records authenticated hosted v1 calls once at the central request
boundary, including denials, failures and idempotent replays. These entries use
a separate transaction after dispatch, so failed actions remain visible. Their
actor and tenant come from the verified member context; subject is the primary
resource `id` in a recognized route, when present. A create request has no path
ID, so its subject is null. Detail contains only operationId (when known),
method, outcome (`success`, `denied`, `failed`) and HTTP status, passed through
the existing redaction. Bodies, query contents/results, credentials and error
messages are never copied. Unknown methods on known OpenAPI routes use
`METHOD /api/v1/<route-template>`; unrecognized routes use
`METHOD /api/v1/{unmatched}` without caller-controlled path text.

Hosted startup checks the schema columns and version/checksum marker before
serving, failing with `AUDIT_SCHEMA_NOT_MIGRATED` or `AUDIT_SCHEMA_MISMATCH`.
Later append failures emit a sanitized `WORKSPACE_AUDIT_APPEND_FAILED`
diagnostic (including the named schema error when applicable); they never
change the action's response. Shutdown/invocation completion awaits appends.
Pre-authentication refusals have no verified member identity and are not
recorded. The history read is excluded. Local fixture v1 dispatch is separate
and has no hosted audit database; this recording covers hosted calls only.

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
