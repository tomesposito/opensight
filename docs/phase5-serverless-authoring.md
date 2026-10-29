# Phase 5: serverless hosted authoring (D-86)

The serverless boundary admits tenant invitations and the v1 analysis/dashboard
routes used by the hosted UI. The shared literal grammar checks paths and
gateway methods, preserves `Limit` and `Cursor`, and continues to reject the
deferred v1 dataset, source, folder and general asset-management routes.
Current tenant authorization and prepared-data admission remain mandatory.

`sr_v1_schema`, `sr_v1_capacity`, `sr_v1_receipts` and `sr_v1_rates` are installed
only by the owner migration. Receipt/rate rows have tenant/namespace RLS. Capacity
rows expose only global and current-tenant counts to the tenant role; runtime
roles own no tables and receive no DDL. Readiness checks the new marker and RLS.
Backup inventory adds `authoring-v1` while recognizing pre-upgrade inventories.
Restoring an older backup initializes empty authoring state, never invented receipts.

Receipts use a 60-second pending reservation and ten-minute completed lifetime,
both measured by database time. Concurrent requests for an occupied key receive
`409 IDEMPOTENCY_IN_PROGRESS` with `Retry-After: 1`. Retrying after the original
write committed returns its stored response only after current authorization and
data checks. A fenced token cannot commit after expiry or tenant deletion.
The analysis/dashboard/share mutation and completed receipt share one SQL
transaction; failed capacity or commit checks roll back both. Tenant deletion
purges receipt payloads and rate windows and releases global capacity atomically.

The existing `OPENSIGHT_RETRY_CACHE_*` entry/byte limits apply globally and per
tenant, including pending entries and complete JSON receipt bytes. The existing
`OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE` defaults to 600 and now shares its window
across Lambda invocations. No interval timers or extra service are needed.
Dashboard JSON query output uses the existing authorized durable result chunks
when it exceeds the control-response threshold; bounded synchronous binary
exports remain subject to the Lambda response envelope limit.

Invitation creation uses `invitation-write` dispatch intent and
`invitation-deliver` outbox event kinds. The existing recovery queue acknowledges
the obligation before invitation and outbox commit together. A failed immediate
queue hint is recoverable. Events carry identifiers only; the existing H2 record
keeps the token encrypted. The request process advertises the worker mail
capability but never loads its SMTP credentials. The worker verifies current
tenant, inviter administrator membership, recipient and invitation state before
SMTP DATA. Accepted/expired/revoked invitations cannot send; duplicate events
cannot resend successful mail. Unknown SMTP outcomes are held as ambiguous and
require the existing explicit operator replay acknowledgement.

Deployment requires a registered backup, migration rehearsal and owner migration
for authoring and monthly usage, followed by the matching runtime and generated
viewer function. It then verifies administrator invitations, author save/publish,
reader queries, cross-tenant denial and exact release state. A passing single-node
HTTP test alone is insufficient evidence for this release.

## Verification and visual review

The isolated PostgreSQL operator rehearsal covers retained-data freeze, registered
migration and exact retry, runtime grants, reopen fencing, held restoration of an
older backup, and atomic rollback after an injected preservation failure. The
operator runner and runtime produce the same schema checksum after bundling.
Initial activation recognizes the empty global capacity row while rejecting
nonzero counters, missing capacity and foreign schema markers.

The static demo was rebuilt and captured in Chromium at 1440 by 1100. Compared
with `docs/images/sample-dashboard.png`, the chart arrangement and values remain
intact (East revenue 500, discounted revenue 450, KPI 500). Existing navigation
and branding differences predate this backend slice. No web UI source changed,
so README media remains unchanged. This static capture is not a deployed server
or a measurement of QuickSight visual parity.

The final root `npm test` run on isolated Linux with PostgreSQL exited 0:
**4,357 passed / 0 failed / 1 skipped** (the unconfigured TLS
PostgreSQL fixture). Python SDK tests ran separately on the host:
**32 passed / 0 failed / 0 skipped**. The private operator rehearsal passed
**4 migration tests and 2 registry tests**, without failures or skips.

The first public acceptance exposed CloudFront CPU throttling on upload
completion. The edge generator now folds the shared grammar's constant regex
templates into literals and rejects non-v1 paths before entering that matcher.
The API grammar and permissions are unchanged. Differential checks cover 364
route variants, including ID limits, malformed paths and deferred surfaces.
The corrected bytecode passed twelve CloudFront engine cases, including the
failing upload path and large synthetic authorization/header sets; maximum
observed compute utilization was 45 percent. The deployment records the exact
edge correction separately from its immutable runtime and migration receipts.

After the edge optimization, the full root suite exited 0 with **4,358 passed /
0 failed / 1 skipped** (the same unconfigured TLS PostgreSQL fixture). This adds
the differential matcher check to the earlier release verification.

The current pilot's SES account remains in sandbox mode and its SMTP IAM policy
restricts recipients to the existing approved address. Application SMTP capability
does not imply permission to deliver invitations to arbitrary recipients. Live
release checks use one exact SES simulator address under an expiring, separately
recorded operator permission, which must be removed before release completion.
General invitation delivery requires SES production access and a reviewed mail
policy; it is not enabled by this application release.
