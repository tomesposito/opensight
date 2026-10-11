# Phase 5 SR3b — on-demand client evidence

The serverless packaging target enables `VITE_OPENSIGHT_SERVERLESS=true`.
Authoring starts at Connect with no API request, uses finite credential-free
startup, and retains local session expiry. Current revocation requires sign-in;
workspace outages hide the app and offer Connect. Failed writes and sign-ins
are never automatically replayed. Dataset execution and refresh use explicit
status checks, and recurring schedule controls are unavailable in this runtime.

Serverless embed shells select a 45-second local display lease. The SDK's
`connectionRequired` event stops initial handshake timers. Connect performs
startup, at most one redemption, current status and content loading. Hide,
freeze, pagehide, expiry and destruction clear protected views and cancel pending
work. Request generations reject late responses; a frame guard checks elapsed
wall time before paint. Successful authority reads measure the lease from request
start. Self-hosted polling and static demo semantics remain unchanged.

Root `npm test` passed **2,423 / failed 0 / skipped 14 / cancelled 0** (2,437 total).
API: 443 passed / 12 live-PostgreSQL skips; bundle parser: 199; embedding SDK: 10;
O interpreter: 32; parity: 11; query engine: 504 passed / 2 live-PostgreSQL skips;
web: 1,210; root conformance: 14. The full run was repeated after applying the
existing sign-in/embedded button styles, with the same counts. Hosted and static
demo builds passed in the pinned offline Linux ARM64 build.

Fake clocks cover 15/35-second startup, six-call and wall-time limits, gateway
Retry-After, hung requests, hidden-page cancellation, explicit reconnect, stale
session failures, terminal redemption ambiguity, lease/session expiry and zero
idle requests. The existing self-hosted suites remain green.

A real browser with synthetic HTTP responses verified zero initial API calls,
explicit Connect and the direct upload's single S3 PUT/accepted operation. A
separate synthetic parent used the compiled embedding SDK and session renderer:
initial Connect, ready, local 45-second hide and explicit reconnect produced
`connectionRequired`, `ready`, `connectionRequired`, `ready`, exactly one
redemption, seven total API requests and no page errors. These are browser
integration checks, not proof of AWS availability or storage CORS.

The rebuilt static demo completed the 251-frame README tour with no page errors
or external requests. The connection screenshots and upload screenshot use
synthetic identities and data. Visual inspection found no new layout gap; this
is not measured QuickSight visual parity.

Public ingress, AWS object-transfer/queue acceptance, deployment activation and
the actual tester workflow remain required. This phase is not a live deployment.
