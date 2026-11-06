# Issue #197 verification and visual notes

The build follows the approved external self-serve signup design and the issue
brief. Neither solution design was edited. Pricing copy and existing site entry
CTAs remain byte-for-byte unchanged. No live-tenant inspection or deployment
was performed, and no dependencies were added.

Local captures in `/tmp/issue197-captures/` cover the unlinked signup page,
trial banner/billing page, expired state, operator Signups panel and freshly
built static demo. Signup and expiry also have 390px captures. The browser used
synthetic API payloads, blocked external requests and reported no page errors.
These captures demonstrate layout; service/HTTP tests independently verify
behavior. They are not evidence of a deployed hosted service.

The signup layout/copy was compared with approved mockup (a), and the paused
card with (c). The implementation keeps the three resolutions, tier choices,
retention date and hierarchy. Accessible radio controls replace decorative tier
cards; the retention copy states operator-triggered erasure accurately. The
paused background contains no fabricated dashboards. The trial banner renders
the server's day count in the existing application chrome. Narrow captures show
all actions without horizontal clipping. Visual fidelity is not measured.

README-linked images show existing product surfaces, which this dark rollout
does not change. Billing navigation appears only for sessions with billing
state; the new signup/trial/operator-signups screens are not README subjects.
The existing hero GIF and README screenshots were therefore not regenerated.

Tests cover trial entitlement precedence and deadline/retention arithmetic,
removal of drop-to-Free, durable mail reservations and recipient counts,
verification expiry/rotation/idempotency, enumeration-safe responses, public
origin/rate/blocklist/challenge refusals, runtime/deploy-off queue preservation,
cap and shared-IP behavior, checkout metadata, identity while paused,
admin-only resolution routes/actions, server countdown rendering and the
existing D-84 erasure/backup integration. The final full root-suite counts are
reported in the delivery message; only live-Postgres integration skips are
permitted when DATABASE_URL is absent.
