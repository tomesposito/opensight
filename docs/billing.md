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

| Variable | Meaning |
| --- | --- |
| `OPENSIGHT_STRIPE_SECRET_KEY` | Stripe secret API key (server-side only). |
| `OPENSIGHT_STRIPE_WEBHOOK_SECRET` | Signing secret for the webhook endpoint. |
| `OPENSIGHT_STRIPE_PRICE_LIGHT` | Stripe price ID for Light ($29/mo). |
| `OPENSIGHT_STRIPE_PRICE_REGULAR` | Stripe price ID for Regular ($99/mo). |
| `OPENSIGHT_STRIPE_PRICE_HEAVY` | Stripe price ID for Heavy ($399/mo). |
| `OPENSIGHT_TRIAL_ENTITLEMENT` | Trial entitlement JSON, validated by the same shape; trial start requires it. |
| `OPENSIGHT_BILLING_TIER_ENTITLEMENTS` | Optional JSON mapping tier names (`free`, `light`, `regular`, `heavy`) to entitlement objects in the `OPENSIGHT_ENTITLEMENTS` shape. Paid billing records require their tier entitlement; missing mappings deny fallback. Legacy stored `free` and operator-created tenants without billing preserve their existing operator defaults. |

Keys and price IDs are configuration only. No key, card data, or customer
payment detail is ever stored in OpenSight or appears in tests.

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
   `invoice.payment_failed`, and `invoice.paid` events. The endpoint
   verifies the Stripe signature against the raw body before trusting
   anything in it; events are applied exactly once (replays are durable
   no-ops), and every entitlement change lands in the operator audit
   trail with the Stripe event ID as the reference.
4. `GET /api/host/tenants/{tenantId}/billing` shows the tenant's current
   tier, subscription status, trial deadline, access state and retention date.

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

## Scope notes

- Composed on the single-node hosted server. The serverless invocation
  composition keeps `/api/host` closed (404), so billing routes —
  including the webhook — are not exposed there yet.
- Tests stub the Stripe client; the suite never calls Stripe.
