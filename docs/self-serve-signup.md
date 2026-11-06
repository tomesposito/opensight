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

Public signup is enabled only with `OPENSIGHT_SIGNUP_ENABLED=true`, configured
billing/trial entitlement and mail. Default is off: all `/api/signup` routes
return 404. Form, resend and slug routes require the exact site origin
`https://getopensight.org`. Verification also accepts the configured app origin.
The form accepts `displayName`, optional `slug`, `adminName`, `adminEmail` and
`challengeToken`. Verification accepts `token`; resend accepts `email`.

`OPENSIGHT_SIGNUP_BLOCKLIST_FILE` names an operator-maintained newline-separated
domain file (comments start with `#`). It is read on each request; missing or
unreadable configuration fails closed. Gmail/Googlemail dots and plus aliases
normalize to one identity; other providers' aliases are preserved. One trial
per normalized email is retained after conversion or closure.

The managed challenge uses `OPENSIGHT_SIGNUP_CHALLENGE_SECRET` on the server,
requires the site hostname and `signup` action, and has an injected verifier for
offline tests. The site's public key is configured separately at deployment.
No external account is created by the build. Rate buckets are durable: form
5/hour/IP, slug 30/hour/IP, resend 3/hour/email plus 5/hour/IP. Forwarded IP
headers are not trusted. Verification tokens are sealed, SHA-256 indexed,
single-use and expire after 24 hours; resending rotates the pending token.
Signup IDs derive existing provisioning idempotency keys. Provisioning and
trial creation share a transaction, and audits carry `via: self_serve_signup`.
