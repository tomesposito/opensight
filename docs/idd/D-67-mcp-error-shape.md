---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve the error model for MCP tool calls.

## Scope

API errors vs protocol errors; the error payload shape.

## Out of Scope

The REST error codes themselves (frozen contract — unchanged).

### 🚧 IDD D-67 — How should MCP surface API errors?

#### CONTEXT

D-42 ✅ approved proposal-first; this is its Q6. v1 errors carry
named `errorCode` values (`RATE_LIMIT_EXCEEDED`,
`SOURCE_DELETE_BLOCKED_BY_DATASET`, `BLAZE_MODE_REQUIRED`,
`V1_IF_MATCH_REQUIRED`, …); 429s carry `Retry-After`. MCP
distinguishes protocol errors (bad JSON-RPC, unknown tool) from tool
results.

#### THE PROBLEM

Agents need to branch on error codes; hiding them behind strings or
protocol errors breaks that.

#### OPTIONS CONSIDERED

1. **API errors are structured tool results, not protocol errors.**
   A v1 error (including 409s, 429s, 428s) returns a tool result
   with `isError: true` and a structured payload
   `{ errorCode, message }` — the same named code the REST operation
   returns, so agents can branch on `RATE_LIMIT_EXCEEDED`,
   `SOURCE_DELETE_BLOCKED_BY_DATASET`, `BLAZE_MODE_REQUIRED`, etc.
   Protocol/transport failures (bad JSON-RPC, unknown tool) are MCP
   protocol errors. Success results carry the REST response body
   unchanged.
2. **Every API error as a protocol error.** Forces agents to parse
   error strings instead of branching on codes; also hides the
   `Retry-After` on 429s.
3. **Errors as successful tool results.** Makes failures invisible
   to agents that check only `isError`.

#### RECOMMENDATION

Option 1. Named codes survive the REST→MCP boundary intact, so
agent error-handling written against REST works unchanged against
MCP. Protocol errors stay reserved for actual protocol failures —
the two failure kinds stay distinguishable.

#### IMPLICATIONS

- The server maps v1 error bodies to `{ isError: true, errorCode,
  message }`, preserving `Retry-After` where present.
- Tests assert code parity across the boundary for the 409 / 429 /
  428 paths.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-42](D-42-headless-mcp-server.md), [D-37](D-37-headless-first-api.md)
