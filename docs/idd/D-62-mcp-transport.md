---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-14
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Resolve the MCP transport for headless v1.

## Scope

stdio vs Streamable HTTP for the first MCP server.

## Out of Scope

Streamable HTTP design (a later slice if approved), MCP prompts/
resources (a later slice, if ever).

### ✅ IDD D-62 — What transport should the MCP server use?

#### DECISION (product owner, Tom, 2026-10-14)

stdio first; Streamable HTTP later as its own slice.


#### CONTEXT

D-42 ✅ approved proposal-first; this is its Q1. No MCP code exists
today — no server package, no SDK dependency, no transport. D-37 ✅
commits to MCP as the second delivery shape after REST+OpenAPI, and
freeze Q7 makes tool names a mechanical 1:1 mapping of REST, not a
second design.

#### THE PROBLEM

A network listener is a new attack surface; stdio keeps the server
local.

#### OPTIONS CONSIDERED

1. **stdio first; Streamable HTTP later as its own slice.** The
   first MCP server is a local process speaking JSON-RPC over stdio:
   no new network listener, no CORS, no HTTP auth surface, and the
   credential lives in the process environment. HTTP transport
   (remote agents, shared servers) needs its own threat review — a
   listening endpoint with bearer auth, origin policy, and
   per-tenant rate limiting at the edge — so it is a follow-up, not
   part of this slice.
2. **HTTP-first (or both now).** Adds a network service to review:
   listener binding, TLS, origin/CORS policy, and how the edge rate
   limiter composes with the v1 limiter.
3. **stdio-only forever.** Keeps remote agents on the REST API
   permanently — no path to shared/remote MCP servers.

#### RECOMMENDATION

Option 1. stdio delivers the agent-native front door with the
smallest security surface; HTTP is not rejected, just sequenced
behind its own threat review. Remote agents keep working via REST
in the meantime, so nothing is lost by staging.

#### IMPLICATIONS

- The MCP server ships as a stdio process; no listener, no CORS
  policy, no TLS to review in this slice.
- Streamable HTTP returns as its own proposal with its own threat
  review when the stdio server is proven.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-42](D-42-headless-mcp-server.md), [D-37](D-37-headless-first-api.md)
