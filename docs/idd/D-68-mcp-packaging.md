---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve where the MCP server lives and what it may depend on.

## Scope

Package location, the MCP SDK choice, server-side state policy.

## Out of Scope

Transport (D-62), credential mechanics (D-63) — packaging assumes
those decisions.

### 🚧 IDD D-68 — How should the MCP server be packaged?

#### CONTEXT

D-42 ✅ approved proposal-first; this is its Q7. The governing
principle: the MCP server is **just another API client** — it calls
v1 over HTTP, never route handlers in-process, never the metadata
store directly, no privileged path. No MCP code exists; the monorepo
packages are `api`, `bundle-parser`, `embedding-sdk`,
`o-interpreter`, `parity`, `query-engine`, `web`.

#### THE PROBLEM

In-process handler reuse would be faster but creates the privileged
second path D-37 forbids; hand-rolled protocol code owns
correctness forever; server-side state needs its own invalidation
and tenant-isolation review.

#### OPTIONS CONSIDERED

1. **A new standalone package (e.g. `packages/mcp-server`) that
   depends on the v1 HTTP API only** — it speaks HTTP to a
   configured v1 base URL, exactly like any other API client. For the
   MCP protocol itself, use the official TypeScript MCP SDK
   (MIT-licensed; license and version verified at implementation)
   rather than hand-rolled JSON-RPC. The package adds no
   server-side state: no cache, no session store beyond the
   short-lived access token, no persistence.
2. **In-process reuse of route handlers.** Faster, but the
   privileged second path D-37 forbids — the exact "second API
   wearing an MCP mask" failure.
3. **Hand-rolled JSON-RPC.** Saves a dependency but owns framing,
   batching, and error handling forever.
4. **Stateful server** (caching results, holding sessions). Needs
   its own invalidation and tenant-isolation review.

#### RECOMMENDATION

Option 1. The standalone HTTP-client package is the architecture
that keeps the "one contract" promise auditable — you can verify it
by reading the dependency list. The official SDK buys protocol
correctness; statelessness keeps the tenant-isolation story
trivial.

#### IMPLICATIONS

- `packages/mcp-server` is created with the MCP SDK as its only new
  dependency (MIT, license verified at implementation).
- Tests assert all v1 calls go over HTTP with no direct store
  access.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-42](D-42-headless-mcp-server.md), [D-37](D-37-headless-first-api.md)
