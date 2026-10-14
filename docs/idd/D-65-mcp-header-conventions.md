---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve how `Limit`/`Cursor`, `Idempotency-Key`, and `If-Match` reach
REST through MCP tool calls.

## Scope

Input-param-to-header mapping; what surfaces in results.

## Out of Scope

The conventions themselves (frozen contract — unchanged).
MCP-native pagination models (rejected below).

### 🚧 IDD D-65 — How do header-carried v1 conventions travel in MCP tool calls?

#### CONTEXT

D-42 ✅ approved proposal-first; this is its Q4. v1 conventions are
header-based: `Limit`/`Cursor` request headers with
`{ items, nextCursor }` responses (headers, not query strings — the
hosted plane rejects `?...`); `Idempotency-Key` on mutations
(10-minute replay window, `Idempotent-Replayed: true`); `If-Match`
optimistic concurrency on deletes (428 `V1_IF_MATCH_REQUIRED` when
missing). MCP tool calls have no native header concept.

#### THE PROBLEM

Tools must carry pagination, idempotency, and concurrency without
inventing a second convention model.

#### OPTIONS CONSIDERED

1. **As ordinary tool input params, mapped to headers by the
   server.** `limit`/`cursor` → `Limit`/`Cursor` request headers;
   `idempotencyKey` → `Idempotency-Key` header; `ifMatch` →
   `If-Match` header. Responses surface `nextCursor` and
   `Idempotent-Replayed` in the tool result. The mapping is
   mechanical and documented per tool; the server adds no header the
   REST operation does not already define.
2. **MCP-native pagination** (cursor embedded in tool results,
   server-side cursors). Diverges from the REST contract — a second
   pagination model to document, test, and keep in sync.
3. **Leave headers out entirely.** Loses idempotency and concurrency
   on tool calls — retried tool calls duplicate, concurrent deletes
   race.

#### RECOMMENDATION

Option 1. The mapping is mechanical, documented, and adds nothing —
agents get the same conventions REST callers get, through params
they can see in the tool schema. No second model, no lost
guarantees.

#### IMPLICATIONS

- Every tool schema documents its header-mapped params; the server
  performs the mapping before calling v1 over HTTP.
- Tests assert header pass-through against a stubbed v1 layer and
  `nextCursor` / `Idempotent-Replayed` surfacing in results.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-42](D-42-headless-mcp-server.md), [D-37](D-37-headless-first-api.md)
