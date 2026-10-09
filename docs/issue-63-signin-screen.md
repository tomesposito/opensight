# Issue #63 — hosted sign-in screen

The supplied issue brief is the implementation contract; HQ-3 and HQ-7 are
settled. `SOLUTION_DESIGN.md` is unchanged. The work stays on
`work/issue-63-signin-screen` without merging, pushing or opening a PR.

## Session configuration

`OPENSIGHT_SESSION_SECONDS` now enforces HQ-7's inclusive 900–36000 second
(15–600 minute) range. Previously the validator accepted 1–86400 seconds.
Out-of-range deployments fail startup with `HOSTED_CONFIG_INVALID`; operators
must use the settled range. The login payload and authentication verifier are
unchanged. Invitation lifetimes are unchanged.

## Sign-in and sign-out

A 401/403 from startup session discovery now renders a dedicated `SignIn` card.
The first step collects email, password and workspace ID (the API's required
`tenantId`, supplied by the administrator). Continue only changes the UI. The
second step collects the six-digit authenticator code and makes one login POST
with `{email,password,code,tenantId}`. Password visibility can be toggled; Back
clears the password and code. Requests time out after ten seconds and duplicate
submissions are suppressed.

The login request uses `credentials: 'omit'` without Authorization. A bearer is
kept only in the API client's closure, never localStorage, sessionStorage,
cookies or URLs. All methods on that client attach it to subsequent requests
and omit cookies. A matching tenant identity from `/api/session` is required
before the application mounts. Cancelled, stale and malformed responses cannot
establish access. Reloading or closing the page discards the credential.

The hosted header supplies Sign out. It removes the mounted workspace, calls
`/api/auth/logout` with the bearer and clears the credential even on failure.
Success is displayed only after the server confirms revocation. A failed request
explicitly says server sign-out could not be confirmed and this page cleared
its sign-in. A late session-check response cannot remount the application.

## Lifetime and errors

Unchecked **Remember me for this session** caps this page's access at 15 minutes.
Checked, it uses the server's configured deadline, capped at 600 minutes. Neither
choice extends the server's expiry or persists across reloads. The server still
issues its configured lifetime; the unchecked choice imposes a shorter browser
deadline and discards its credential at that deadline, without claiming early
server revocation. There is no session renewal.

An exact deadline timer, a check on window focus and a check before authenticated
requests enforce expiry. The sign-in screen then says **Your session has expired**.
The existing 30-second session polling detects server revocation; each server
request independently verifies admission. Denials without a known elapsed
deadline say the session is no longer valid, rather than inventing an expiry or
account-lock reason.

`AUTHENTICATION_FAILED` during login says **Invalid email or password**, with
instructions to check the authenticator code or contact the administrator. The
API does not distinguish wrong credentials, unknown accounts, rejected MFA or
blocked access. Rate limiting (`AUTH_RATE_LIMITED`) says to wait 15 minutes;
key revocation, unavailable built-in auth, request/origin/identity rejection,
invalid fields, unavailable tenants and revised access have named guidance.
Unexpected named errors retain their safe code and a generic failure message.
Raw backend/proxy text is never rendered by the sign-in screen.

Invitations, password reset and locked-account assistance point to the
administrator. No reset, signup or external OIDC flow is simulated. The existing
password/TOTP verifier, enrollment and tenant-switch API are unchanged.

## Modes and visual review

`SECURITY_NOT_CONFIGURED` still probes the explicit local-data capability. Local
mode has no login gate. Offline demo mode never requests a session. Explicit
sample exploration remains available without granting hosted access.

The private reference is reviewed in [gap notes](issue-63-gap-notes.md). New
captures live outside the repository in `/tmp/issue63/`; they use only synthetic
test accounts. No dependency or reference asset was added. The static demo is
rebuilt locally and is not a deployed server.

## Verification

Targeted checks cover the login transport, response validation, named failures,
TOTP steps, timeout/cancellation, logout failure, stale responses, the 15- and
600-minute browser boundaries, 30-second revocation, and unchanged local/demo
behavior. A real hosted API test uses durable temporary SQLite, the existing
password/TOTP verifier and a stub mail transport; logout is verified against the
server's revoked token. Responsive browser checks cover 1440/760/390/320px.

The real hosted browser tour passed email/password → TOTP → rejected code →
successful session → sign-out → second login → expiry, with no page errors or
external requests. Static-demo captures for five surfaces at two viewport widths
were pixel-identical to the pre-change baseline. No demo-visible UI changed;
README media was therefore not refreshed.

The first full-suite run exposed three inherited draft-test assertions left
stale by the preceding `8e86d6d4` copy/UX commit: two expected “Reopen” and one
assumed the analysis name was not a button. The tests now target “Open”, verify
that the name opens the same draft, and check disabled controls by name.
No draft implementation changed. All 53 targeted checks passed after correction.

Final root `TZ=UTC npm test` exited 0: **2,053 passed / 0 failed / 12 skipped /
0 cancelled** (2,065 tests). All skips require live PostgreSQL. Passing counts:
API 305, bundle parser 199, embedding SDK 9, interpreter 32, parity 11,
query engine 502, web 988 and root conformance 7. The final static-demo/embed
build completed successfully. Final desktop/mobile demo comparisons remain
pixel-identical, and the refreshed hosted browser tour passed all steps with
zero page errors or external requests.

Work is checkpointed on the issue branch. No merge, push, PR, deployment,
new dependency, private reference or personal data is included.
