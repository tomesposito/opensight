---
status: ✅ Confirmed (product owner, 2026-10-16)
owner: Tom Esposito
date: 2026-10-16
labels: [idd]
---

## Purpose

Freeze how someone gets into the hosted product, so the marketing
site's conversion path and the operator's provisioning workload are
decided (issue #107).

## Scope

The signup/onboarding motion. The underlying tenant model is D-80.

## Out of Scope

Trial length/terms detail (later call), self-serve provisioning
implementation (deferred by this decision).

### ✅ IDD D-79 — How does someone get in? (trial and signup)

#### CONTEXT

No self-service path exists today: the tenant-management plane is
blocked at the public edge, tenants need operator-minted invitation
tokens. Empty-state-first: new workspaces feel empty, sample data
opt-in only. Security lines hold: rate limiting on every route,
scoped credentials via the invitation path.

#### THE PROBLEM

Without a way in, the paid product can't convert from the marketing
site. What's the signup motion?

#### OPTIONS CONSIDERED

1. **Self-serve signup → tenant auto-provisioned → 14-day trial,
   no credit card.** Empty workspace, opt-in sample dataset.
2. **Same, card upfront.** Fewer tire-kickers, more friction.
3. **Request access / waitlist.** Operator provisions by hand
   (status quo).

#### DECISION

Option 3 — request access / waitlist, operator provisions by hand.

#### REASONING

Tom's pick. The marketing CTA points at request access, not at a
self-serve funnel — the product isn't ready to charge anyone yet
(standing position, Oct 12), so a waitlist matches where the product
actually is. Known tradeoff, recorded honestly: manual provisioning
keeps Tom as the bottleneck on every signup — the opposite of the
standing division of labor (the loop does what's automatable; he
does credentials and cloud). The self-serve motion (option 1) stays
the future direction; HQ-2 already anticipates it as a product layer
calling the operator API.

#### IMPLICATIONS

- Marketing CTA = request access / waitlist (not self-serve signup).
- Operator hand-provisions each tenant (provision-tenant on its
  branch, awaiting Tom's review, is the tool for this).
- No trial-expiry/deprovision machinery needed yet; revisit when
  the product is ready to charge.
- Abuse surface stays small: invitation path only, no public
  signup to defend.
