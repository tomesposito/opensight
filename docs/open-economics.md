# Open economics: the features that are never paywalled

OpenSight is Apache-2.0 software. The hosted service charges for running it, not for unlocking it. Core governance — single sign-on, row-level security, the audit log, and basic embedding — stays in the open product and is never paywalled. Paid tiers buy higher usage quotas and support. Nothing else.

This page is the rule that binds future pricing and packaging work (issue #165). It sits on top of the earlier free-vs-paid decision (D-77) and the pricing model (D-78): tiers differ by quantity, never by which governance features a workspace gets.

## What counts as core governance

- **Single sign-on.** Identity integration for a workspace's members. (Not built yet: the pilot ships built-in email and password with TOTP MFA, and external OIDC is the designed follow-on behind the existing verifier seam. When SSO lands, it lands in the open product.)
- **Row-level security.** The dataset and row/column rules that decide who sees which data, documented under Permissions and row-level security. Shipped, and part of every tier.
- **The audit log.** The record of who did what in a workspace and on the operator plane, including its retention behavior on tenant erasure (D-84). Shipped, and part of every tier.
- **Basic embedding.** Embedding a dashboard or visual in another page with the product's own session and origin rules. When embedded analytics ships, its basic form is in the open product. (This is a packaging commitment, not a schedule: hardened customer embed domains stay unscheduled until a customer requires them, per HQ-9.)

## What paid tiers buy instead

From D-77 and D-78: hosting, backups, updates, uptime, support, and higher quotas. The quotas are the numbers in the entitlement record — API calls, storage bytes, compute attempts, monthly egress bytes, and AI spend caps. That record is the whole paid line today: it has no field that turns a feature on or off.

## The audit behind this page

Publishing the rule came with a check of the current product (2026-11-03, issue #165):

- The entitlement type in `packages/api/src/hosted-usage.ts` carries quantities only — `apiCalls`, `storageBytes`, `computeAttempts`, `egressBytes`, and the AI spend-cap fields. No feature flags exist in it.
- No code path in the API or web packages gates a feature on a tier. Enforcement raises `USAGE_LIMIT_EXCEEDED` when a quota is spent; it does not hide governance features from smaller tiers.
- The marketing site and the published docs named no governance feature as paid or enterprise-only. A guard test in `site/build-docs.test.mjs` now fails the suite if a published page puts one of the four behind a paid or enterprise tier, or if this rule disappears from the published docs.
- Behavior tests in `packages/api/test/open-economics-tiers.test.mjs` (added 2026-11-07, issue #215) exercise the executable side: the entitlement parsers reject any governance feature-flag field, and row-level security, the audit log, basic embedding and the identity verifier seam are exercised under every billing tier's entitlement with a sufficient quantitative allowance. The site guard now scans every published site page — pricing, alternatives, vs, signup and legal included — not just the homepage and the docs.

One older note needed correcting. D-77 (decided 2026-10-16) called SSO and audit logs "the future enterprise lever — decided if a buyer ever asks." A buyer-independent answer arrived on 2026-10-30, when the scope of this rule was confirmed as written. For the four features named above, the lever is settled: they are not one.

The current hosted tiers this rule governs are on the [pricing page](/pricing/).
