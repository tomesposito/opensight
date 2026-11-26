---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-11-25
labels: [idd]
---

# Hosted session restore

## Purpose

Record Tom's silent-restore decision in issue #282 on 2026-11-25.

## Scope

Hosted app sign-in sessions, page reloads, and workspace wake behavior.

## Out of Scope

Embed sessions, browser storage of bearer tokens, and deployment authorization.

### ✅ IDD D-99 — How should the hosted app recover sign-in after a page refresh?

#### CONTEXT

The hosted bearer session lives only in a JavaScript closure. Reloading the
page destroys it, so an on-demand workspace shows Connect and then requires
another full sign-in. The existing session policy caps access at 15 minutes
without remember-me or 10 hours with remember-me. HQ-7's memory-only,
no-cookie posture also covers embeds, which have a separate session model.

#### THE PROBLEM

How should a page refresh recover a still-valid hosted app sign-in?

#### OPTIONS CONSIDERED

1. ✅ **Option (a): silently exchange an HttpOnly refresh cookie for a fresh
   bearer before showing Connect or sign-in.**
2. Retain the current Connect and full sign-in sequence after every reload.

#### REASONING

Tom selected option (a) in issue #282. Reloading an awake workspace should
require no user action; reloading a sleeping workspace should show only the
wake wait. An opaque cookie keeps the bearer in memory and the refresh
credential inaccessible to page JavaScript, while accepting the need for
server-side refresh storage, cookie request protection, rotation, and
revocation. Option 2 preserves the existing implementation but repeats
authentication while the user's session is still valid.

#### IMPLICATIONS

- Sign-in sets an HttpOnly, SameSite refresh cookie, Secure for hosted HTTPS.
  Store only its hash server-side; never put a bearer in a cookie or browser
  storage, and never return a refresh credential in JSON.
- Restore runs before any access gate, after credential-free startup/wake
  when needed. A missing or invalid cookie falls back to the current gates.
- Refresh tokens rotate on exchange, cannot be replayed, and retain the
  original session deadline: 15 minutes or 10 hours with remember-me.
- Logout, session revocation, tenant suspension, and user disable/removal
  prevent restoration. Admission fails closed with named errors.
- This supersedes HQ-7's “credentials stay in memory, not cookies” posture
  **only for the hosted app sign-in session**. Embed sessions are unchanged.
