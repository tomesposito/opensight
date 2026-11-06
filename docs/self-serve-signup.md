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

Tenant mail uses one transport wrapper and durable counters/receipt keys.
Trial allowance is 25 recipients total (across month boundaries); paid monthly
allowances are Light 500, Regular 5,000, Heavy 25,000, calendar UTC month.
Legacy stored Free uses 100/month. A shared message counts every recipient.
Quota errors are `EMAIL_LIMIT_EXCEEDED` (429). Retry keys do not spend twice;
ambiguous send failures keep the reservation rather than risk exceeding the cap.
Initial provisioning, verification and operator notifications do not count.
