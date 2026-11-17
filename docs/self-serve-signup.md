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
is 30 days from that deadline, unless a pending paid request holds the clock
under [waiting-list conversion](waiting-list-conversion.md) (#241). Pauses and starts are operator-audited.

There is no drop-to-Free route or operator action. Paused workspaces resolve
through payment or a manual paid-request grant, data export or closure; erasure follows the existing D-84
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

The unlinked `/signup/` page follows approved mockup (a); all existing site CTAs
and pricing files stay unchanged. Deploy supplies the public challenge key in
`signup-challenge-site-key`; absent configuration keeps the submit button off.
The mail link enters `#signup=...`, then existing `#invite=...` enrollment.

Session responses carry `{ trial: { endsAt, daysRemaining } | null }` plus billing
state. Banner dismissal lasts only for the signed-in component session. Checkout
is administrator-only and uses Stripe HTTPS, with tenant/tier metadata on both
the session and subscription; existing operator payment links remain available.
Paused identity, billing, export and closure are outside quota charging. Product
requests still return the specific pause error. Portability exports shared
namespace metadata, the current member's private assets and authorized source
output. It preserves RLS/CLS and output bounds, excludes credentials, and states
its scope in the archive. Other owners' private assets require their own exports;
this endpoint does not turn admin membership into a source-policy bypass.
Closure uses the existing tenant lifecycle tombstone; D-84 erasure remains an
offline operator maintenance operation, never a second deletion implementation.

The operator Signups panel uses `GET/PATCH /api/host/signups`, with the same
operator credential and browser-origin boundary as the existing operator plane.
`OPENSIGHT_SIGNUP_VOLUME_CAP` defaults to 25 starts per rolling 24 hours. The
same source IP gets at most three starts in that window before joining the
queue; shared IPs are not treated as permanent identities. Cap and runtime
pause checks share the provisioning transaction lock. The runtime pause row is
operator-audited, survives restarts and never affects existing tenants.

Verified queued signups keep their pending record. A single-node worker retries
at startup, every minute and on operator resume; every retry rechecks admission.
Provisioning's existing invitation is the workspace-ready email. Incomplete
mail delivery resumes the same provisioning operation instead of creating a
second tenant. Deploy-off never drains queued signups. The panel reports UTC
daily starts/conversions/expiries, rolling starts, cap state and queue depth.

Retention due appears on tenant details and in the Signups panel; its entry
point opens the existing delete confirmation. That creates the existing D-84
lifecycle operation. The operator then runs the existing frozen maintenance
`delete-tenant` command (dry-run first), with its tenant confirmation and backup
copy requirements. Erasure inventories/deletes billing and mail records and
scrubs signup PII. The normalized email is stored only as a digest; the lifetime
one-trial ledger and audit facts survive erasure. Encrypted reference backups
include the new stores and restore them with the existing held-access policy.

Outside reference and serverless invocation modes, the hosted server composes
the existing quota service whenever `OPENSIGHT_ENTITLEMENTS` is present, billing
is configured, or signup is enabled (#213). Turning signup off keeps existing
tenant quotas enforced. Present entitlements are validated; when absent, the
deployment defaults remain unrestricted for operator-created tenants without
billing. Trial and paid billing records override those defaults fail-closed.
Reference and invocation composition are unchanged. The signup flag controls
signup routes, queue draining and the trial/mail startup requirements.
With #241, single-node billing and its quota overrides also stay active without
Stripe configuration; quota settings remain independently validated.
Embed authorization and tenant mail also check billing expiry. The session's
`billingPaused` flag, like trial days remaining, is computed using the server
clock so browser clock skew cannot decide whether the pause screen appears.

Deployment remains separate: Tom's live-tenant review, approved pricing/CTA
replacement, Stripe configuration, challenge keys and rollout switch are not
performed by this build. No signup is enabled by shipping this code.
