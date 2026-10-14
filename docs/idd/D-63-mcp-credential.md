---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-14
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Resolve credential carriage for the MCP server.

## Scope

How the server obtains and holds its identity; what tools may and may
not accept.

## Out of Scope

The REST auth model itself (D-37 decision 4, frozen contract —
unchanged). Per-request HTTP bearer (HTTP-only, belongs to the later
transport slice).

### ✅ IDD D-63 — How does the MCP server get its credential?

#### DECISION (product owner, Tom, 2026-10-14)

Server started with a refresh token from the operator invitation/minting path via environment/config; never logged, echoed in tool results, or accepted as a per-tool parameter; the server exchanges it for short-lived access tokens and calls v1 as that user in that tenant; no tool accepts a credential, principal, or policy assertion.


#### CONTEXT

D-42 ✅ approved proposal-first; this is its Q2. D-37 decision 4:
user-level, tenant-scoped credentials via the operator
invitation/minting path. The frozen contract: secure refresh token,
short-lived access, rotation, revocation. The REST layer rejects
`FORGED_PRINCIPAL` assertions — the MCP server must not open a path
around that.

#### THE PROBLEM

The server must act as exactly one user in one tenant — never as a
conduit for injected identities.

#### OPTIONS CONSIDERED

1. **Server started with a refresh token from the operator
   invitation/minting path.** The token is supplied via
   environment/config at server start, never logged, never echoed in
   tool results, and never accepted as a per-tool parameter. The
   server exchanges it for short-lived access tokens and calls v1 as
   that user, in that tenant. No tool accepts a credential,
   principal, or policy assertion — those are rejected the way the
   REST layer rejects `FORGED_PRINCIPAL`. Revocation takes effect
   the same way it does for REST (the server holds no independent
   session).
2. **Per-request Bearer.** HTTP-only; moves credential handling to
   every call and needs a caller-identity story.
3. **Server-wide service principal.** Contradicts D-37's user-level
   credentials.
4. **Credentials as tool inputs.** Would let a prompt-injected agent
   exfiltrate or swap identities.

#### RECOMMENDATION

Option 1. One identity, established at startup, carried the D-37 way
— the server cannot be talked into being someone else, and
revocation flows through the existing path with no parallel session
to invalidate. The never-logged / never-echoed rule keeps the token
out of tool results an agent might paste elsewhere.

#### IMPLICATIONS

- Server startup takes the refresh token from env/config; the
  server exchanges it for short-lived access tokens per call.
- Contract tests assert credential-carrying tool params are
  rejected, revoked credentials fail closed, and no credential
  appears in logs or results.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-42](D-42-headless-mcp-server.md), [D-37](D-37-headless-first-api.md)
