---
status: ✅ Confirmed (product owner, 2026-10-16)
owner: Tom Esposito
date: 2026-10-16
labels: [idd]
---

## Purpose

Freeze the billing provider for the hosted product, so the future
billing implementation has a named dependency (issue #107).

## Scope

Provider choice only. No billing code is authorized by this decision.

## Out of Scope

Billing implementation, webhook handling, tax setup — all later,
and only after D-77–D-80 are confirmed (they are).

### ✅ IDD D-81 — Who processes the money? (billing provider)

#### CONTEXT

Usage-based pricing (D-78) needs a billing system that handles
metered usage, trials, and tax. Tom is a solo operator; the business
entity and merchant account are his side, like AWS. Standing rule:
no billing code until the product decisions are made.

#### THE PROBLEM

Stripe Billing, a merchant-of-record (Paddle), or manual invoicing?

#### OPTIONS CONSIDERED

1. **Stripe Billing.** Standard SaaS billing; per-seat and metered
   native; Stripe Tax available.
2. **Paddle (merchant of record).** They handle global VAT/sales
   tax; higher fees, less control.
3. **Manual invoicing.** Fine for the first enterprise deal, not a
   self-serve motion.

#### DECISION

Option 1 — Stripe Billing. Revisit Paddle only if international tax
becomes a real pain.

#### REASONING

Stripe is the default for this shape of SaaS and handles metered
usage natively, which D-78 requires. Paddle's merchant-of-record
value only pays off once international tax is actually hurting;
paying their fee upfront is premature. Option 3 can't serve a
marketing-site funnel and stays available as the fallback for a
first enterprise deal before self-serve is done.

#### IMPLICATIONS

- Tom: Stripe account + business entity (his checklist, operator
  work like the AWS setup).
- When billing is built: webhook handling for trial→paid, usage
  reporting, payment failures.
- Still no billing code — usage metering (D-78) and the product
  decisions above come first.
