# Issue #162 — metric digest gap notes

## Product decision follow-up (issue comment draft)

The approved IDD allows shared email lists but requires authorization for every
recipient at delivery. Existing OpenSight identities represent personal
workspace members; there is no verified shared destination or membership
registry. Please decide the authoritative list-membership source and the rule
for combining recipients' different RLS views into one shared message. Until
then, the owner/admin gate is enforced and shared destinations fail with
`DIGEST_SHARED_DESTINATION_UNRESOLVED`. The run brief explicitly directs stopping
that part and shipping the remainder when a new product decision is required.
No issue comment was sent: this build permits no network access or publishing.

Slack connections do not exist in this workspace implementation. Slack delivery,
threshold/anomaly alerts and AI explanations remain outside this slice.

## Data-access boundary

Subscriptions grant no source or recipe access. Readers can subscribe when the
existing bound query path is executable as that reader. A published metric's
metadata visibility alone does not make another author's source or prepared
recipe executable. Protected source preparation remains refused by the existing
prep security policy; protected legacy dataset queries intersect dataset/source
RLS and CLS. These checks are covered by real contained-query tests.

## Visual verification

The static demo was rebuilt. The new browser acceptance script,
`packages/web/scripts/verify-metric-digests.mjs`, uses the real hosted test API,
built-in authentication, SQLite metadata and contained query workers, and blocks
all external requests. It covers subscribing from the existing Metrics tab,
drill-back preview, mobile layout and unsubscribe.

In this environment Chromium exits before opening a page with:
`Hatch WebGL domain policy is required for browser startup`. The installed
Chromium README says this image-owned policy must be supplied by browser-daemon;
that facility is not available to this run. The policy was not bypassed.
Consequently no new screenshots, reference comparison or README hero GIF could
be captured. Existing README imagery was retained rather than represented as
fresh. Browser layout/fidelity remains unverified; React interaction and real
HTTP tests cover the functional flows. Run the capture script and the existing
README GIF capture/assembly workflow once browser provisioning is restored.
