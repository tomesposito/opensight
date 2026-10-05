---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-05
labels: [idd]
---

## Purpose

Decide whether the hosted product offers customer-owned embed domains
at launch, and who owns the verification, certificate, renewal, and
DNS-support burden that comes with them.

## Scope

The business decision: whether custom embed domains are in launch
scope, and the ownership model for domain verification, certificates,
renewal, and DNS support.

## Out of Scope

The technical machinery itself (proof-of-control protocol, certificate
automation, routing implementation) — that becomes a follow-on ITD
only if custom domains are approved. Embed session shapes and the
`AllowedDomains` contract (decided: HQ-6, HQ-7, HQ-12).

### ✅ IDD HQ-9 — Are custom embed domains required at launch, and who owns verification, certificates, renewal, and DNS support?

#### CONTEXT

H6 shipped embed sessions with static + runtime `AllowedDomains` (≤3
per call) under an exact origin policy, and the H8 reference runs a
canonical origin that does not verify or provision customer domains.
The design already constrains any future custom-domain support:
origin checks are never disabled for custom domains, tenant identity
is never chosen from `Host` alone, hostname claims must be globally
unique, and stale DNS must not permit takeover. HQ-7 put embed
credentials in memory rather than cookies, which removes the classic
third-party-cookie driver for same-origin custom domains. HQ-10 B
commits the pilot to best-effort operations with no availability
promises, which bounds what certificate-renewal automation may promise.

#### THE PROBLEM

Are custom embed domains required at launch, and who owns verification, certificates, renewal, and DNS support?

#### OPTIONS CONSIDERED

1. ✅ **Canonical origin only: no customer hostnames at launch; embeds run on the OpenSight canonical origin under the existing `AllowedDomains` origin policy; custom domains explicitly unscheduled until a customer requires them.**
2. Operator-managed custom domains: OpenSight owns domain verification, certificate issuance and renewal, routing, and DNS support; customers register hostnames against their tenant.
3. Customer-managed (bring-your-own): the customer owns DNS and certificates; OpenSight verifies proof-of-control, routes verified hostnames only, and surfaces renewal failures as safe errors (`EMBED_DOMAIN_UNVERIFIED`); renewal risk stays with the customer.

#### REASONING

Option 1 is selected: the lowest operational surface and the current
de facto posture. H6's `AllowedDomains` already answers the
embed-origin need for most integrations, and HQ-7's in-memory
credentials removed the strongest technical driver for same-origin
domains. No launch customer requires a custom hostname, so there is
no reason to take on certificate renewal, DNS support, and the
takeover-attack surface now. The trade-off knowingly accepted: if a
future customer requires their own hostname for brand or policy
reasons, this decision reopens — the revisit trigger is explicit: a
customer requirement, not speculation.

Option 2 gives customers full brand control but makes every
certificate renewal an operator incident: issuance/renewal automation,
DNS support, and the takeover-attack surface all become OpenSight's
burden, against HQ-10 B's best-effort posture. It requires the full
H11 acceptance battery (takeover attempts, revoked-domain sessions,
certificate failure and renewal drills).

Option 3 splits the burden — OpenSight's contract is verification
plus routing, the customer owns renewal risk — but it creates a
support-boundary problem ("whose certificate failed?") and still
requires the proof-of-control and anti-takeover machinery. It is
viable only with a crisp verification contract and safe,
non-leaking errors for unverified hosts.

#### IMPLICATIONS

- If Option 1 is confirmed: H11 stays unscheduled; the canonical
  origin is the documented position; no domain-registry work is
  needed. Revisit when a customer requires a custom hostname.
- If Option 2 or 3 is confirmed: H11 becomes scheduled work, and a
  follow-on ITD is required for the verification and certificate
  machinery (proof of control, globally unique claims, anti-takeover,
  renewal-failure handling, safe errors).
- Under Option 2, the operator runbook gains a domain-lifecycle
  section and support policy must define DNS support boundaries;
  renewal failures must surface as safe errors, never as
  availability incidents (HQ-10 B).
- Related decisions: HQ-5 (white-labeling scope — "domain" there is
  product-domain branding, distinct from customer hostnames), HQ-6 /
  HQ-7 / HQ-12 (embed contracts and origin policy), HQ-10 B
  (best-effort operations), H11 (the optional slice this unblocks).
