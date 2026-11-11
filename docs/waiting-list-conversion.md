# Waiting-list conversion (#241, D-93)

A complete Stripe configuration selects checkout. With no Stripe configuration,
conversion uses paid requests; there is no additional flag. Partial Stripe
configuration still fails startup. The existing `OPENSIGHT_TRIAL_ENTITLEMENT`
and `OPENSIGHT_BILLING_TIER_ENTITLEMENTS` settings work in both modes, with the
same validation and quotas. Missing tier entitlements prevent a manual grant.
Signup remains gated by its existing deployment switch.

An administrator can request Light, Regular or Heavy from day one of a trial,
change the pending request's tier, or withdraw it. `POST /api/billing/paid-request`
accepts only `{ tier }`; `DELETE` withdraws. Both require a tenant administrator
and the configured app origin. The server resolves the requester from active
membership/identity records. The `h11_paid_requests` ledger records the request,
requester, tier and lifecycle. Tenant locking inside the write transaction and
a partial unique index enforce one pending request per tenant on both database
dialects. Tier changes preserve its ID, original date and requester.

Session billing state contains `billingMode` and `paidRequest` (tier, state,
createdAt, and requestedByEmail). The requesting address is included so the
waiting screen names the correct recipient even when another administrator
views it. Operator billing detail additionally supplies the durable request ID.
No client infers mode from checkout errors or configuration.

A pending request holds paused retention indefinitely. Expiry still pauses
access at the trial deadline, but assigns no retention date while waiting.
Withdrawal or decline starts a fresh 30 days for a paused workspace; during a
live trial it preserves the trial clock. Decline permits another request.
Grant applies the requested tier immediately, clears trial/pause/retention
clocks, restores access, and marks `entitlement_source = manual`. It creates no
payment or subscription. Existing manually granted tenants keep their plan
when Stripe is later configured. Subscription linking remains out of scope.

`GET /api/host/signups` includes the pending paid-request queue, oldest first,
its count, and billing mode. Pending requests never enter its retention-due
list. Closed/deleting tenants are excluded. Tenant detail and the queue resolve
requests through `POST /api/host/tenants/:tenantId/billing/paid-request/grant`
or `/decline`, with `{ requestId }`. The deployment operator credential and the
existing narrow browser-origin boundary apply; a stale ID fails closed.
The request lifecycle writes `billing.paid_request.created`, `.tier_changed`,
`.withdrawn`, `.granted`, and `.declined` in the mutation transaction. Manual
trial conversion also feeds the existing daily conversion count.

New requests send a courtesy copy through the existing mail transport to
`OPENSIGHT_ACCESS_REQUEST_NOTIFY_TO`. Grants send the decided confirmation to
the requesting admin. Both use HTML escaping and stable 64-character delivery
keys, outside tenant email quotas. Delivery failure logs
`BILLING_PAID_REQUEST_MAIL_FAILED` without transport details or email addresses;
it cannot undo a request or grant. The operator queue is the system of record.
No new delivery worker or retry policy is introduced.

Reference backups include the request ledger. D-84 inventories and erases it,
including requester identity data; audits remain under the existing policy.
The migration is additive and idempotent. Existing trial rows are marked
`trial`, existing non-trial billing rows `stripe`. Checkout, payment-link and
webhook reconciliation retain their existing behavior; the retention hold also
covers a pending request if Stripe is configured later.
