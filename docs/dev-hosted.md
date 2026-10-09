# Local hosted-mode development

`npm run dev:hosted` (from the repo root) runs the real hosted-mode stack on your
machine: the hosted API with email/password + TOTP auth, tenant isolation, and the
built web client served on the same origin.

## First run

1. Run `npm run dev:hosted`.
2. It generates `.env` (gitignored, mode 600) with fresh dev keys and a dev password.
3. It provisions a dev tenant and admin user in `.opensight/dev-hosted.sqlite` (gitignored).
4. It prints a QR code — scan it with any authenticator app (one time only).
   The `otpauth://` URI is also printed for manual entry.
5. Open http://localhost:3001. The sign-in screen appears. Sign in with the printed
   workspace ID, email, password, and a TOTP code from your authenticator app.

Later runs reuse the same `.env` and database, so the dev account persists.
Delete `.env` to regenerate keys, or delete `.opensight/dev-hosted.sqlite` to
re-provision from scratch.

## What this is and isn't

- This is the **real hosted auth flow** — no stubs, no bypasses. The sign-in screen,
  session lifetimes, and TOTP verification are the production code paths.
- It is **local only**. The API binds to 127.0.0.1 and the database is a local file.
- `.env` holds secrets. It is gitignored; never commit it, never share it.
- The `http://localhost` origin is accepted under a documented loopback exception in
  `packages/api/src/hosted-config.ts` (RFC 8252 §7.3: loopback origins cannot be
  exploited remotely, and sessions are Bearer <redacted> memory, never cookies).
  Any non-loopback origin still requires https.
