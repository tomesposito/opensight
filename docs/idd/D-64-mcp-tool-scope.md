---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve which REST operations get MCP tools now.

## Scope

The initial tool inventory; the deferred-tool policy.

## Out of Scope

The deferred tools' designs (owned by D-39/D-40/D-41), composite
tools (the calling agent's job — never proposed).

### 🚧 IDD D-64 — What tool scope should the MCP server ship?

#### CONTEXT

D-42 ✅ approved proposal-first; this is its Q3. 11 v1 operations
are implemented (datasets + querying: list/describe/update/delete/
query/lineage/refresh/refresh-status, list/describe/delete sources).
40 more are proposals across D-39 (13), D-40 (12), and D-41 (15).
Freeze Q7: tool names are a mechanical 1:1 mapping of REST, not a
second design.

#### THE PROBLEM

Building tools ahead of their REST operations would freeze API
design through the MCP side door.

#### OPTIONS CONSIDERED

1. **Tools only for implemented REST (the 11 operations).**
   Analyses/dashboards/assets tools land when D-39/D-40/D-41 freeze.
   The MCP server never exposes a tool whose REST operation is still
   a proposal.
2. **Build deferred tools now.** Freezes REST operations through the
   MCP side door — the exact silent-freeze failure the
   proposal-first slices exist to prevent.

#### RECOMMENDATION

Option 1. The review gates stay meaningful: no MCP tool exists until
its REST operation is approved and implemented. `tools/list` can
never advertise what doesn't exist, so agents never call phantom
operations.

#### IMPLICATIONS

- 11 tools at first; the 40 deferred tools follow each slice's
  approval mechanically — their designs are owned by D-39/D-40/D-41.
- Tests assert `tools/list` returns exactly the implemented set: no
  more, no fewer.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-42](D-42-headless-mcp-server.md), [D-37](D-37-headless-first-api.md)
