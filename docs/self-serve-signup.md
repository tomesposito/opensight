# Self-serve signup (#197)

The rollout is dark by default. Pricing copy, site entry CTAs and existing
operator-created tenants are unchanged. Deployment and the live-tenant review
remain operator tasks.

Billing represents a trial with a nullable `h9_billing.trial_ends_at`, not a
new tier. `OPENSIGHT_TRIAL_ENTITLEMENT` is a JSON entitlement with the same
validation as a tier entitlement; use Light quotas. Paid tiers take precedence.
An expired trial denies entitlement fallback and returns `TRIAL_EXPIRED` (403).
Expiry is persisted on startup and request/state inspection with the effective
pause at the original deadline, even when observed later. The retention date
is 30 days from that deadline. Pauses and starts are operator-audited.

There is no drop-to-Free route or operator action. Paused workspaces resolve
through payment, data export or closure; erasure follows the existing D-84
operator maintenance flow. Stored `free` values remain compatible.
