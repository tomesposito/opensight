---
status: ✅ Confirmed (product owner, 2026-10-16)
owner: Tom Esposito
date: 2026-10-16
labels: [idd]
---

## Purpose

Freeze where the free/paid line sits for the hosted OpenSight
product, so pricing, signup, and billing decisions have a contract to
build against (issue #107).

## Scope

The hosted product's free-vs-paid boundary. Self-hosted licensing is
unchanged (full Apache-2.0, no crippleware).

## Out of Scope

Dollar amounts, billing implementation, signup mechanics (D-78–D-81).

### ✅ IDD D-77 — Where's the line between free and paid?

#### CONTEXT

The repo is public Apache-2.0 and marketing leads with "powerful open
source BI tool." Today there is no paid product and no self-service
path: the tenant-management plane is blocked at the public edge,
tenants need operator-minted invitation tokens, and the bootstrap
refuses on a non-empty DB (tenant #3 currently has no provisioning
path). Quota enforcement exists (#91 shipped USAGE_LIMIT_EXCEEDED).
Tom's standing position (Oct 12): the product isn't ready to charge
anyone yet — these decisions set direction now; no billing code until
he says so.

#### THE PROBLEM

A hosted paid product needs a free line: what costs money, and what
does "free" mean when the entire product is open source? This gates
every other decision below.

#### OPTIONS CONSIDERED

1. **Paid = we run it for you.** Identical product; you pay for
   hosting, backups, updates, uptime, support. Nothing feature-gated.
2. **Open-core.** Core free/self-hosted; paid gates enterprise
   features (SSO/SAML, audit logs, embedding/white-label).
3. **No free hosted tier.** Trial → paid only; self-hosted is the
   free option.

#### DECISION

Option 1, plus a bounded free hosted tier.

Same product everywhere; the free tier is quota-bounded and acts as
the funnel; paid tiers are higher quotas plus support and SLA. No
feature gates now. SSO and audit logs are noted as the future
enterprise lever — decided if a buyer ever asks.

#### REASONING

Leading with "open source BI tool" while paywalling features reads as
bait-and-switch and breaks honest-over-fake. The tenant model already
isolates per customer, so per-tier quotas are the natural paid line —
and the quota machinery is built. The marketing page needs a CTA that
isn't "contact us"; a bounded free tier is that CTA. Feature gates
would add entitlement plumbing a solo operator can't afford to
maintain. Option 3 leaves the marketing site with no conversion path
at all.

#### IMPLICATIONS

- Free-tier quotas get defined (storage, seats, datasets); paid =
  higher quotas + support + SLA.
- Self-hosted stays full Apache-2.0, no crippleware.
- No entitlement system to build now.
- Open-source repo relationship (issue #107, question 6): everything
  stays MIT-equivalent Apache-2.0 in the repo; the hosted-only part
  is operations (hosting, backups, SLA), not withheld features.
