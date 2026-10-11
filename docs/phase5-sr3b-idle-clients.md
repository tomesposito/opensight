# Phase 5 SR3b — on-demand browser and embed connections

This implements D-26's confirmed initial test experience and the finite client
startup portion of D-21. It adds no infrastructure, dependencies, authentication
provider or automatic mutation replay. The public ingress/cost profile is a
separate release contract.

## Activation and compatibility

The serverless hosted frontend is built with `VITE_OPENSIGHT_SERVERLESS=true`.
This is a public deployment-mode boolean, never an origin, credential or identity.
`createApiClient` accepts an optional on-demand option and exposes its immutable
`onDemand` property. The serverless packaging target sets this build flag. Static
demo behavior and self-hosted clients without it retain their existing behavior.
Serverless embed shells carry `idleReconnect: true`; legacy self-hosted embed
shells retain H6's existing polling contract. The published SDK accepts the new
nonterminal event without weakening source/origin/session/channel validation.

## Startup

Expose a shared browser startup helper for authoring and embed clients. It sends
only POST `/api/api/startup` with `{}`, JSON/Accept headers, credentials omitted,
no bearer, cache or redirect. Start only after explicit Connect, never on mount,
focus, timer or visibility restoration. Allow one in-flight startup per helper;
concurrent Connect gestures share it rather than starting more requests.

One attempt window has a 120-second wall-clock deadline and at most six requests.
Each request has a 25-second abort deadline, also capped by the remaining window.
Retry only 503 WORKSPACE_STARTING or HTTP 429. After a response, use jitter within
half-to-full 5/10/20/30/30-second ceilings; a valid Retry-After is a lower bound.
If the delay will exhaust the window, stop. Ready means exactly HTTP 200 with
`{state:"ready"}`. Maintenance, unknown errors, malformed success and network
failures stop the window and expose explicit retry; no database diagnostics are
shown. Abort a pending request/wait on hidden page, navigation, cancellation or
unmount. No timeout leaves a timer/listener or a later success publication behind.

Startup never retries login, MFA, enrollment, invitation acceptance, single-use
redemption, upload completion, save, deletion, mail or other business requests.
After startup, the original user action is not automatically replayed. The user
submits credentials/actions again. Existing operation Check status remains the
way to inspect an accepted upload after transport ambiguity.

## Authoring

An on-demand SessionGate initially shows Connect and performs zero network calls.
Connect runs startup, then one existing session check. A missing bearer leads to
the existing sign-in form. Keep passwords/MFA out of the startup helper. Login and
logout remain one explicit request each, with existing generation/timeout rules.
A deliberate Retry/Connect may repeat startup and one session read, never a write.

Remove the periodic session check and automatic focus checks in this mode.
Keep local session-expiry timers and check elapsed expiry before every protected
request and on visibility restoration. API client subscriptions report only safe
`authentication-required` or `connection-required` events, never tokens or data.
A current-session 401/expiry clears credentials and causes sign-in. A current
WORKSPACE_STARTING/UNAVAILABLE/MAINTENANCE response (or gateway 502/504) hides the
application and offers Connect while preserving only the existing memory bearer
until its original expiry. It does not replay the failed request or extend the
session. Late prior-session results cannot affect the replacement session.

Dataset execution/refresh views read once on user navigation or explicit Check
status, and after their own completed action. In on-demand mode they do not run
five-second intervals. Existing generation checks and explicit action failures
remain. Disable recurring refresh-schedule controls with a factual unavailable
message in this runtime; manual refresh and saved execution choices remain.
No periodic startup, health, session, job or refresh request is introduced.
SR2d operation polling remains restricted to accepted foreground work and its
existing 120-second bound. Self-hosted polling/scheduling behavior is preserved.

## Embedded display lease

Add nonterminal client states `idle`, `connecting` and `unavailable`. The initial
validated SDK handshake selects idle and presents Connect. It does not redeem a
bootstrap until an explicit Connect has completed startup. Preserve memory-only
bootstrap/credential custody; redemption is attempted at most once. An ambiguous
redeem is terminal and requires a new session URL. Never renew it automatically.

After redemption (or an existing in-memory credential), Connect checks current
status and reloads content. Only successful authority-checked responses can
renew a display lease, capped by the original session expiry. Conservatively
measure the maximum 45 seconds from that request's start, so response transit
cannot extend authority beyond the last server check. Pointer movement, typing,
local chart interactions and timers do not renew it. Protected requests require
an unexpired lease; valid explicit data interactions may renew it on success.

At lease expiry, remove protected content and local protected editing state and
show Connect without making a request. Hidden/pagehide/freeze events immediately
hide it and abort foreground reads/startup. Visibility/focus/pageshow restoration
checks elapsed wall time and leaves it hidden; no automatic reconnection. Check
expiry before each render/input publication and use a local animation-frame guard
while a protected view is ready so frozen timers cannot leave a resumed stale
view authorized. Stop the guard when hidden/idle/terminal. State changes that hide
content flush before the next paint. Credentials stay only in memory until their
original session expiry, destruction or terminal authorization failure.

A failed startup/status transport leaves a recoverable unavailable view and
Connect; definitive expiry/revocation and ambiguous redemption remain terminal.
Late responses after disconnect, hide, expiry or destroy cannot restore content.
Question/save/analysis actions are never replayed by reconnect; reload only the
existing authorized content GET. A successful save keeps H6's terminal saved
behavior. Lease expiry does not alter the 15–600-minute session lifetime.

Emit `connectionRequired` when entering idle/unavailable after a validated parent
handshake. Add optional SDK `onConnectionRequired`; accepting this event ends the
initial readiness/handshake timer without requesting another URL. `onReady` can
fire again after an explicit reconnect. Existing expiry/revocation/saved/error
callbacks and message source/origin/channel checks remain. No parent message
contains credentials, bootstrap, rows, definitions or object URLs. SDK `refresh`
continues to explicitly request a new session URL; no automatic renewal is added.

## Acceptance

Fake timers cover 15/35-second readiness, never-ready and hung requests, six-call
and wall-clock bounds, Retry-After/jitter, hidden-page abort, single-flight startup
and no login/MFA/write replay. Authoring tests show no mount/idle/focus/resume SQL
requests in on-demand mode, explicit reconnect, local expiry and late-session
rejection. Refresh/execution tests verify explicit checks and disabled scheduling.
Embed/SDK tests cover strict handshake, 45-second and earlier session expiry,
hidden/frozen/resumed pages, late requests, reconnect outage/revocation, one-shot
redemption and zero idle requests. Existing self-hosted tests remain green.

Run root npm test, report exact counts, rebuild hosted/demo and refresh the README
GIF and changed screenshots. These browser tests are not Aurora pause or public
site evidence. Public activation still requires the separate ingress/release and
live tester workflow acceptance.
