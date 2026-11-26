# Hosted session restore (#282)

[D-99](idd/D-99-session-restore.md) lets a page reload recover a valid hosted
sign-in before rendering an access gate. The bearer remains in the API client's
closure. Browser JavaScript neither reads nor writes the refresh cookie, and
neither credential is placed in localStorage, sessionStorage or a URL.

## HTTP contract

- `POST /api/auth/login` and `/api/auth/login/select` accept an optional boolean
  `remember` (default false). Completed sign-in returns the existing
  `{token, expiresAt, tenantId}` JSON and sets `opensight_refresh`.
  A workspace-picker challenge does not set a cookie or issue a session.
- `POST /api/auth/restore` with `{}` reads only the cookie. It returns the same
  bearer response after rechecking tenant, membership, active identity, security
  revisions, key, origin, issuer and audience. Unknown, expired, revoked,
  malformed and replayed credentials return 401 with `AUTHENTICATION_FAILED`;
  retired signing keys retain `AUTH_KEY_REVOKED`. No partial session is returned.
- Rotation consumes the old hash and issues a fresh refresh token and bearer
  in one transaction. The prior bearer is revoked. Concurrent exchanges of one
  cookie have at most one winner. The client does not retry a rotating POST.
- `POST /api/auth/logout` with `{}` expires the cookie and revokes its session.
  It accepts cookie-only logout after bearer expiry or tenant suspension;
  bearer-only callers also revoke the linked refresh credential. Workspace
  switching issues a replacement cookie bound to the selected membership.

The cookie is host-only, HttpOnly, SameSite=Lax and Secure on HTTPS. Loopback
HTTP development omits Secure. `Path=/api` covers both direct `/api/auth/...`
and the hosted proxy's `/api/api/auth/...` routes. It never contains the bearer,
and refresh values never appear in JSON responses. Cookies ride only on the
same-origin login, restore and logout transport; ordinary authenticated API
requests continue to omit cookies and use the memory bearer.

All cookie operations require JSON POSTs, use the existing exact host/origin
boundary and return `Cache-Control: no-store`. Restore rejects Authorization
headers, principal claims, tenant selectors and duplicate refresh-cookie names.
Ordinary API routes do not authenticate through the cookie.

## Lifetime and revocation

Unchecked remember-me caps both credentials at 15 minutes. Checked caps them
at 10 hours; the existing `OPENSIGHT_SESSION_SECONDS` deployment ceiling can
shorten either lifetime. Restore and workspace switching preserve the original
deadline. Activity and repeated reloads cannot extend it.

Only a SHA-256 digest of each cryptographically random 256-bit refresh value is
stored in `h2_refresh_tokens`, in the privileged membership store. Each row is
bound to its H2 session and tenant. Session revocation and membership/security
revision checks also fence restore. Suspension followed by resume cannot revive
old credentials; disabled/removed users cannot restore. Tenant erasure removes
refresh rows, and backup recovery revokes their authority.

The auth migration creates the additive table. Serverless migration/grant,
readiness, backup and initial-state inventories include it; operators must run
their normal owner migration before using updated serverless runtime code.
The generated and packaged edge route files also include the restore path and
must ship with that runtime; no infrastructure change is applied by this build.
No new environment variables or dependencies are needed.

## Page load

The hosted client attempts restore once before Connect or sign-in. On-demand
clients first run the existing credential-free startup POST and its bounded
wake wait. An awake workspace proceeds directly to the app; a sleeping one
shows the wait. Restore failure falls through to the existing gates. Local
security probes and explicit sample exploration remain available, and the
offline static demo makes no restore call. Embed sessions are unchanged.

Logout clears the page's bearer even if transport fails, while clearly reporting
that server sign-out was not confirmed. Such a failure cannot claim to have
revoked the HttpOnly cookie. Reload remains subject to the server's real state.

## Verification

`npm test` includes HTTP, security, client and component coverage. The browser
acceptance script `packages/web/scripts/capture-session-restore.mjs` exercises
the real local auth server and browser cookies with synthetic accounts and a
stubbed wake response; it blocks external network requests. It checks awake
and sleeping reloads, rotation, no gate flash, logout and the post-logout
Connect fallback. See [gap notes](issue-282-gap-notes.md) for final results.
