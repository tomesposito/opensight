---
status: ✅ Confirmed (product owner, 2026-10-16)
owner: Tom Esposito
date: 2026-10-16
labels: [idd]
---

## Purpose

Freeze the pricing-model structure for the hosted product, so the
billing design (D-81) and seat/usage metering have a contract (issue
#107).

## Scope

Pricing structure only. Dollar amounts are a separate later call.

## Out of Scope

The free/paid line (D-77, decided), billing provider (D-81, decided),
metering implementation.

### ✅ IDD D-78 — How do we charge? (pricing model)

#### CONTEXT

QuickSight charges per author/reader (session pricing for readers) —
the target buyer already thinks in those terms. Our identity model:
credentials at user level, scoped to user-tenant, through the
operator invitation path. One namespace per tenant (HQ-1). D-77
decided: same product everywhere, quotas are the paid line.

#### THE PROBLEM

Per-seat, flat per-tenant, or usage-based? Structure only — dollar
amounts are a separate later call.

#### OPTIONS CONSIDERED

1. **Per-seat: Author $X/mo, Viewer $Y/mo.** QuickSight-shaped.
2. **Flat per-tenant per month.** Simplest to implement.
3. **Usage-based** (storage + query compute). Most "fair," least
   predictable.

#### DECISION

Option 3 — usage-based.

#### REASONING

Tom's pick. Usage maps directly onto the cost driver (storage +
query compute) and onto the quota machinery that already defines
the free/paid line in D-77. Known tradeoffs, recorded honestly:
usage is the least predictable of the three for buyers, and the
metering it needs is not built yet — metering design and
implementation are prerequisite work before billing can ship.
Per-seat was the QuickSight-shaped alternative; Tom chose usage.

#### IMPLICATIONS

- Usage metering must be designed and built (storage + query
  compute per tenant) before any billing code.
- Buyer-facing usage reporting/estimates are part of the product,
  not an afterthought — predictability is the model's main risk.
- Free tier = bounded usage quotas (ties to D-77).
