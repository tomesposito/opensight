# Issue #63 — sign-in visual review

Reviewed against the local-only `qs-signin.jpg` reference on 2026-10-09.
The reference remains outside git; no account data or reference screenshots
were copied into the repository. Review captures are in `/tmp/issue63/`.

## Hosted screen

The reference uses a small, centered white card on a quiet tinted background,
product branding above the form, compact field labels, a password-visibility
checkbox, a filled primary action and an outlined secondary action. OpenSight
uses that structure with its navy text, teal diamond/primary button, system font
and teal background tint. The card is 360px wide, with 28px inner padding and
36px inputs/actions; at 320px it fits within 16px page gutters.

The OpenSight credentials card is taller than the pictured password-only step:
it includes email, the backend-required workspace ID and explicit bounded
remember-me guidance. The authenticator step retains the card and branding,
shows the email and one six-digit field, and supplies the outlined Back action.
Errors appear below the heading, above the fields, with an accessible alert and
safe named error code. No distinction between bad password, rejected TOTP and
blocked account is invented. Known expiry and confirmed sign-out have their own
messages; confirmed sign-out uses a neutral status rather than an error alert.
The hosted header keeps Sign out visible with long account names at 320px.
There is no simulated password-reset link; assistance directs the user
to the administrator, consistent with preprovisioned accounts.

Captures: `signin-desktop.png`, `signin-760.png`, `signin-390.png`,
`signin-320.png`, `signin-totp.png`, `signin-error.png`,
`signin-signed-out.png`, and `signin-expired.png`.

The browser tour used the real hosted API with isolated durable SQLite,
synthetic credentials and stub invitation mail. A local test transport supplied
the trusted reverse-proxy Host; no external origin was contacted. It checked
keyboard focus, zero submission on Continue, rejected TOTP, successful login,
server-confirmed sign-out and expiry. Result: 3 login POSTs, zero page errors,
zero external requests; no localStorage/sessionStorage credential writes.
Desktop and mobile layout tests cover initial and expired states at
1440/760/390/320px. No new in-scope visual defect remains from this comparison;
visual parity is not claimed.

## Static demo

The static demo remains an offline fixture artifact and never shows sign-in or
Sign out. Before/after captures cover Home, Analyses, Data sources, Data
preparation and Author at 1440px and 390px. All ten before/after image pairs
are pixel-identical (zero differing pixels). The tour reported zero page errors
and zero external requests. No demo-visible UI changed, so the README hero GIF
and existing feature screenshots were not regenerated. The hosted sign-in
captures remain local review artifacts.

Final verification: root `TZ=UTC npm test` exited 0 with **2,053 passed /
0 failed / 12 skipped / 0 cancelled**. All skips require live PostgreSQL.
The final static demo and embed artifacts were rebuilt; the final hosted
browser tour and all ten demo image comparisons passed.
