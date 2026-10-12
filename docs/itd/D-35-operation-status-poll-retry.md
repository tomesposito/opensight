---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-12
labels: [itd]
---

### ✅ ITD D-35 — Should the upload UI automatically retry a stale status read?

#### CONTEXT

A live release smoke check reproduced a valid HTTP 403 `METADATA_REVISED`
while polling an ingestion operation: the worker published the source between
the status read and its final authorization recheck. A fresh authorized status
read succeeds. The API must continue to fail closed for the stale read —
denying data on stale revisions is correct behavior, not a bug.

Inspection of the hosted client shows the upload UI
(`packages/web/src/DirectUpload.tsx`) pauses polling on ANY read error and
requires a manual **Check status**. For this narrow race that means a benign
server-side recheck forces the tester to click. The deployment smoke client
already handles the case with at most two fresh reads. Issue #92 asks for the
same narrow handling in the UI client.

#### THE PROBLEM

Should the UI automatically re-read status after a 403 `METADATA_REVISED`,
or always require manual recovery? If it retries, what bounds apply, and how
does the API's fail-closed behavior survive on the client?

#### OPTIONS CONSIDERED

1. Retry only the stale-read signal: operation-status GET responses with
   status 403 and errorCode `METADATA_REVISED`, bounded to at most 2 fresh
   reads with a small delay, each re-authorizing before use.
2. Keep the current behavior: pause on any read error and require **Check
   status** for everything, including the benign race.
3. Retry any read error, or all errors including mutations.

#### REASONING

Select option 1. A stale read is an expected consequence of the fail-closed
recheck, not a denial worth surfacing: the very next authorized read
succeeds, so asking the tester to click is friction without information.
But the retry must stay narrow, because option 3 is dangerous — retrying a
real denial, a revoked session, or a mutation would weaken fail-closed,
hide revocations, or replay writes.

The bounds: at most 2 fresh reads per read attempt, 1 second between them —
matching the deployment smoke client's proven bound. Each fresh read goes
through the client's normal authorized fetch (current bearer token plus the
session-generation guard), so a revoked session surfaces as 401 /
`AUTH_REQUEST_SUPERSEDED` and pauses immediately instead of retrying.
Anything that is not a 403 `METADATA_REVISED` on a status GET pauses,
surfaces the error, and preserves the existing **Check status** recovery.
Mutations are never retried.

Option 2 is rejected: it is honest but noisy, and the issue explicitly
schedules the narrow client improvement. Option 3 is rejected as unsafe.

#### IMPLICATIONS

Implement in `packages/web/src/DirectUpload.tsx`'s poll loop only:
- Wrap the status fetch in a bounded loop. On a 403/`METADATA_REVISED`
  error, wait 1s (abort-aware), then re-issue the GET — max 2 fresh reads.
- After exhaustion, or on any other error, keep the existing behavior:
  pause, surface the error, **Check status** remains the recovery path.
- Abort (unmount, cancel, hidden tab), the 120-second polling deadline,
  hidden-tab pausing, and the session-generation guard are unchanged.
- Deterministic tests: publication race recovers silently; repeated
  revision changes exhaust the bound and pause; a revoked session is never
  retried; cancellation during the retry wait issues no further read.
- No API contract change, no authorization-policy change, no new
  dependencies, no visible UI change (transient behavior only — no
  screenshot or README refresh).

Related: issue #92, `docs/hosted-architecture.md` §7 open-question register.
