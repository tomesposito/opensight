---
status: ✅ Confirmed (product owner, 2026-10-16)
owner: Tom Esposito
date: 2026-10-16
labels: [idd]
---

## Purpose

Freeze how paid hosting maps onto the tenant model, so the signup
product layer (when built) and the operator API have a contract
(issue #107).

## Scope

Tenant architecture for the hosted product. Signup mechanics are
D-79; pricing is D-78.

## Out of Scope

Pooled multi-tenancy as a cost optimization (rejected here).

### ✅ IDD D-80 — How does paid hosting map onto the tenant model?

#### CONTEXT

HQ-1: one namespace per tenant. HQ-2: the operator provisions
tenants; self-service signup, if wanted, is a product layer calling
the operator API. HQ-12: match QuickSight's tenancy/identity shapes
by default, never weaken the tenant boundary. The provision-tenant
command is approved but unmerged on its branch — it touches the live
admin plane.

#### THE PROBLEM

Does the paid product reuse the operator/tenant split as designed,
or does it need a cheaper multi-tenancy model for low tiers?

#### OPTIONS CONSIDERED

1. **One tenant (namespace) per customer.** Signup product layer
   calls the operator API to mint tenant + invitation. Trial and
   paid share the model; only quotas differ.
2. **Pooled multi-tenancy** with row-level isolation for cheap
   tiers. Cheaper to run, weaker boundary.
3. **Operator-only provisioning.** Paid onboarding stays manual.

#### DECISION

Option 1 — one tenant (namespace) per customer.

#### REASONING

This is exactly what HQ-1/HQ-2/HQ-12 already describe — the paid
product turns the existing crank instead of inventing a second
architecture. Option 2 creates two security models to maintain and
crosses the never-weaken line. Option 3 doesn't scale and keeps Tom
in the loop on every signup (though D-79 keeps manual provisioning
for now as the waitlist-era motion; this decision is the model the
future self-serve layer will use).

#### IMPLICATIONS

- provision-tenant must land (Tom's review) — it is the
  provisioning tool for both the waitlist era (D-79) and the future
  self-serve layer.
- Signup service gets scoped operator credentials; per-tier quota
  profiles per tenant.
- Tenant lifecycle design: trial expiry → convert or deprovision
  (needed when self-serve arrives).
