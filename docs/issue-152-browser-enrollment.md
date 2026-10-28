# Browser invitation enrollment (#152)

Hosted invitation emails lead with `<origin>/#invite=<token>`. New invitees set
and confirm a password, register TOTP with the displayed QR code or selectable
base32 setup key, and confirm a live authenticator code. Account and issuer come
from the validated `otpauth` URI. The plain sign-in page has no enrollment fields.

The browser reuses `POST /api/auth/enroll` and `POST /api/auth/accept`; their
contracts and existing protection against credential resets are unchanged.
Passwords must meet the server's validation rules. Interrupted setup can resume
with the same invitation and password. Errors retain their server names; an
invalid invitation or authentication failure clears the setup state and stops
the flow. The API intentionally does not distinguish invalid invitations from
incorrect credentials in its `AUTHENTICATION_FAILED` response.

After confirmation, the hash is cleared. Email and password pass to sign-in only
in memory. The user must wait for a fresh TOTP code because acceptance consumes
the previous time step. Sign-in opens the only active workspace or the named
workspace picker (D-83). No secret, password or token is persisted by enrollment
or sent to analytics. The API workflow remains available for automation.

If enrollment reports `enrollmentRequired: false`, the page continues to sign-in
and preserves the invitation. The existing-account sign-in link follows the
same path. After authentication, the invitee explicitly accepts through the
session-based `POST /api/invitations/accept` endpoint. The hosted router previously
matched `accept` as an invitation ID and returned 405; this slice adds the missing
handler before that route. It verifies the source membership and authorization
revision, locks both workspaces in stable order, rechecks invitation state, and
activates only a membership belonging to the same identity. Used, expired,
revoked, foreign and suspended-workspace invitations are denied. Acceptance
neither resets credentials nor issues a session nor switches workspaces.

The QR encoder is dependency-free, in-repository TypeScript. Its parameter tables
retain Kazuhiko Arase's MIT license notice alongside the project's Apache-2.0
code; no new dependency was added. It encodes the exact ASCII `otpauth` URI as QR
byte mode, error-correction level L, versions 1–40, with a four-module quiet
zone in the rendered SVG. Tests compare every module with the independent MIT
implementation already installed in the API's `qrcode-terminal` development
dependency, at every capacity/version boundary and for actual URI shapes,
including percent-encoded Unicode account names. The reference implementation
is not bundled into the browser.

Root `npm test` includes enrollment UI, API client, invitation mail, QR and hosted
HTTP regressions. Persona journeys J2 and J7 exercise invitation-to-workspace
enrollment in real Chromium against local PostgreSQL; J2 also enrolls its Reader
AI through the browser. Their helper reads only the displayed secret and waits
for a fresh code; it never sends an enrollment request by hand. J2's existing
second-workspace API membership acceptance is unchanged.

No new configuration or product decision is required. The enrollment screen
requires the hosted API and does not exist in the static demo. Demo-visible UI
is unchanged, so README feature screenshots and the hero GIF need no refresh.
