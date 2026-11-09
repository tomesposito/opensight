# Hosted billing (Stripe)

Issue #194, provider decided in D-81 (Stripe Billing), prices decided
2026-10-28 (flat tiers, quotas hard-stop overage — there is no metered
billing and no overage charge). Issue #197 adds dark-by-default
[self-serve signup and 14-day trials](self-serve-signup.md), while retaining
the operator payment-link flow. Existing site entry CTAs remain unchanged
until the separately authorized rollout.

## Configuration

Billing is enabled only when the full Stripe configuration is present in
the environment. With no Stripe variables set, billing is disabled and
the product works exactly as before. A partial configuration is an
operator error: the hosted server refuses to start
(`BILLING_CONFIG_INVALID`).

In non-reference, non-invocation hosted deployments, billing configuration also
composes quota enforcement even when self-serve signup is off (#213). Explicit
`OPENSIGHT_ENTITLEMENTS` are validated and supply deployment defaults; without
them, defaults remain unrestricted. Trial and paid tier entitlements override
those defaults fail-closed, while operator tenants without billing keep them.

| Variable | Meaning |
| --- | --- |
| `OPENSIGHT_STRIPE_SECRET_KEY` | Stripe secret API key (server-side only). |
| `OPENSIGHT_STRIPE_WEBHOOK_SECRET` | Signing secret for the webhook endpoint. |
| `OPENSIGHT_STRIPE_PRICE_LIGHT` | Stripe price ID for Light ($29/mo). |
| `OPENSIGHT_STRIPE_PRICE_REGULAR` | Stripe price ID for Regular ($99/mo). |
| `OPENSIGHT_STRIPE_PRICE_HEAVY` | Stripe price ID for Heavy ($399/mo). |
| `OPENSIGHT_TRIAL_ENTITLEMENT` | Trial entitlement JSON, validated by the same shape; trial start requires it. |
| `OPENSIGHT_BILLING_TIER_ENTITLEMENTS` | Optional JSON mapping tier names (`free`, `light`, `regular`, `heavy`) to entitlement objects in the `OPENSIGHT_ENTITLEMENTS` shape. Paid billing records require their tier entitlement; missing mappings deny fallback. Legacy stored `free` and operator-created tenants without billing preserve their existing operator defaults. |

API credentials remain configuration only. Billing operations snapshot the
nonsecret Stripe price ID so a retry uses the original request. No secret key,
card data, or customer payment detail is stored in billing operations; tests
use synthetic Stripe identifiers and credentials.

Tom's remaining steps (outside the product): create the Stripe account,
create the three products/prices, and put the key, webhook secret, and
price IDs in the deploy environment.

## Operator flow

1. Open `#operator-tenants` in the hosted app and connect with the operator
   credential. Create the tenant with operator-configured quotas; selecting
   a paid starting plan then generates a payment link. The detail page offers
   payment links and paused retention details. See [operator provisioning](h2-tenant-sessions.md#operator-provisioning-pages-192).
2. `POST /api/host/tenants/{tenantId}/billing/payment-link` with
   `{ "tier": "light" | "regular" | "heavy" }` returns a Stripe-hosted
   payment link bound to that tenant. Send the link to the customer; they
   pay on Stripe's pages.
3. Stripe calls `POST /api/host/billing/webhook`. Configure the Stripe
   webhook endpoint for `checkout.session.completed`,
   `customer.subscription.created/updated/deleted`,
   `invoice.payment_failed`, `invoice.paid`, and `invoice.payment_succeeded` events. The endpoint
   verifies the Stripe signature against the raw body before trusting
   anything in it; events are applied exactly once (replays are durable
   no-ops), and every entitlement change lands in the operator audit
   trail with the Stripe event ID as the reference.
4. `GET /api/host/tenants/{tenantId}/billing` shows the tenant's current
   tier, subscription status, trial deadline, access state and retention date.

## Retry-safe creation (#227)

Both payment-link and checkout creation first commit a pending row in
`h9_billing_operations`: operation ID, unique idempotency key, tenant, kind,
tier, original price ID, checkout origin when applicable, status and timestamps.
Stripe object ID and URL are recorded on completion. Every Stripe POST sends
the stored key as `Idempotency-Key`; retries use the stored request, including
after a configuration change or process restart.

Reservation checks and insertion take the tenant lock used by webhook handling
(`SELECT ... FOR UPDATE` on PostgreSQL, `BEGIN IMMEDIATE` on SQLite). A second
transaction takes the same lock, rechecks tenant availability and the checkout
subscription guard, reads the operation, and holds the lock through the Stripe
POST and result commit. Concurrent callers wait and then return the committed
result without another POST. This also coordinates separate service instances.
The tradeoff is that a slow Stripe request holds a tenant lock on PostgreSQL
and the metadata writer transaction on SQLite until it finishes. There is no
in-memory reservation or lease timeout to recover after a process crash.

- **Payment links:** the same tenant and tier reuse the completed `{id, url,
  tier}` indefinitely. Different tenants or tiers have separate operations.
  Completion writes `h9_billing_links` and `billing.payment_link.created` in
  the same transaction, once per creation; reuse writes neither. Legacy link
  bindings remain valid for webhooks, but their URLs were never stored, so
  they cannot be reconstructed as reusable operation results.
- **Checkout:** the second request returns the reserved session's `{id, url}`.
  While the first POST is running, it waits for the database lock. Reservation
  is per tenant across all tiers: requesting another tier still returns the
  original session and its original tier. The completed session is reused for
  **24 hours from successful result persistence** (`updated_at`), strictly
  younger than 24 hours. Reuse does not extend that timestamp. Counting from
  persistence prevents delayed reconciliation from shortening the window for
  a session Stripe may only just have created. At exactly 24 hours, a fresh
  operation and fresh key may be created. This is a bounded reservation, not
  a live check of the Stripe session's expiry or completion; subscription
  webhooks remain authoritative. `billing.checkout.created` fires once per
  recorded creation, and checkout does not insert a payment-link binding.
- **Failure and recovery:** Stripe failures return `STRIPE_REQUEST_FAILED`
  (502) and commit `failed` with the original key and request. A retry resumes
  that operation; a timeout or 5xx never authorizes a new key. If a process
  dies before result commit, the committed reservation survives as pending
  (or retains its earlier failed state) and the database releases its lock.
  A subsequent caller can immediately resume it using the same key, including
  a stale pending operation. Unresolved operations are never discarded by the
  completed-checkout reuse window. Stripe's retention of its idempotency result
  bounds recovery of an ambiguous external creation; this table does not
  provide a separate Stripe-object lookup after that result is forgotten.

The operation table participates in encrypted reference backups and tenant
erasure. Initialization is additive and repeatable on SQLite and PostgreSQL.
No new error code is introduced: invalid paid tiers remain
`BILLING_TIER_INVALID` (400), unavailable tenants `TENANT_UNAVAILABLE` (403),
missing checkout origin/client support `BILLING_CHECKOUT_UNAVAILABLE` (503),
and a bound subscription other than `canceled` or `incomplete_expired` remains
`BILLING_SUBSCRIPTION_EXISTS` (409), including when a reusable session exists.

## Event reconciliation (#211)

The verified event must include a nonnegative integer `created` timestamp
in Unix seconds; missing or invalid timestamps return `STRIPE_EVENT_INVALID`
(400). Only the exact event types listed above can change billing. Other
types, including unlisted `customer.subscription.*` types, are recorded in
`h9_billing_events` as `ignored` without resolving or changing a tenant.

Subscription and invoice events must refer to the tenant's currently bound
subscription. A missing or different subscription is recorded as
`foreign_subscription` and cannot change the tier, status, access, retention
dates, customer or subscription binding. Tenant metadata and customer lookup
locate a tenant; they do not authorize arbitrary updates or invoices to bind
a subscription. Binding creation or replacement is limited to checkout
completion with tenant metadata (or the existing stored operator payment
link), and `customer.subscription.created` for the already-bound customer.
Checkout resolved only through customer lookup cannot replace a binding.

The billing row stores the last applied Stripe creation time in
`last_stripe_event_created` (`lastStripeEventCreated` in the billing response).
Older events are recorded as `stale`. Equal timestamps use **first applied
wins**: Stripe creation times have one-second precision and event IDs do not
establish chronology, so another event from the same second is also `stale`.
This deliberately retains the first committed state until a strictly newer
eligible event arrives. Rejected or ignored events never advance this value.
The subscription check precedes ordering, so an event for a foreign
subscription is classified as `foreign_subscription` even if it is older.

Resolution, checks, event recording, billing writes and audit entries share
one database transaction. PostgreSQL locks the tenant row before reading the
billing state, including when no billing row exists yet; SQLite serializes
writes with `BEGIN IMMEDIATE`. Replayed IDs remain durable no-ops, including
IDs previously recorded as stale, foreign or ignored. Stale and foreign events
do not send pause notifications or entitlement-change audits.

Initialization adds a nullable timestamp column to existing installations and
is safe to repeat. Legacy rows have no ordering baseline until their first
eligible event is applied; historical Stripe creation times were not stored
and cannot be reconstructed from receipt times. This change preserves the
retry-window, cancellation and shared paused-state behavior below.

## Past-due behaviour (amended by #197)

- A failed payment puts the subscription `past_due` while Stripe retries;
  access continues during the retry window.
- When the subscription goes `unpaid` (retries exhausted), the tenant's
  hosted product access **pauses**: product requests are refused with
  `BILLING_ACCESS_PAUSED` (403). Data is retained; nothing is deleted.
  Identity, billing, authorized export and closure remain available. A
  cancelled subscription pauses the same way at period end.
- The operator is notified when a tenant enters the paused state (audit
  entry `billing.access.paused`, plus email to the operator notification
  address when mail is configured).
- Resolution is payment in Stripe, authorized export, or workspace closure.
  When the subscription returns to active, the webhook restores the paid tier.
  There is no drop-to-Free method, route or UI action.
- Data is retained for 30 days from `pauseEffectiveAt`; erasure then enters the
  existing D-84 operator maintenance flow. Trial expiry uses this same state
  with `TRIAL_EXPIRED` (403) and audit reason `trial_expired`.
- There is no automatic downgrade and no grace window beyond Stripe's
  retry cycle.

## Scheduled work (#226)

The hosted scheduler expires trials and checks billing access before admitting
due jobs. Paused tenants create no new scheduled occurrences; their jobs stay
enabled and due so the next tick can run them after payment restores access.
Already queued occurrences fail with `TRIAL_EXPIRED` or
`BILLING_ACCESS_PAUSED` before source access or `computeAttempts` admission.
Execution rechecks and delivery checks also enforce billing, including before
shared-digest rendering and its compute charge. A pause during work stops it at
the next recheck; previously admitted compute is not refunded. Delivery denials
record the billing code on the cancelled delivery without stopping the job.
The hook is optional for compositions without hosted billing; manual enqueue
retains its existing request gate and claim semantics.

## Scope notes

- Composed on the single-node hosted server. The serverless invocation
  composition keeps `/api/host` closed (404), so billing routes —
  including the webhook — are not exposed there yet.
- Tests stub the Stripe client; the suite never calls Stripe.
