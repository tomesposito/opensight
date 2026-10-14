---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve tool discovery and the versioning contract for MCP tools.

## Scope

`tools/list` contents, tool descriptions, version reporting,
breaking-change policy.

## Out of Scope

The deferred tools' designs (owned by D-39/D-40/D-41 — this IDD only
governs when they appear).

### 🚧 IDD D-69 — How do agents discover and version MCP tools?

#### CONTEXT

D-42 ✅ approved proposal-first; this is its Q8. Freeze Q7: tool
names are a mechanical 1:1 mapping of REST. D-37's stability rule:
breaking changes require a version bump and migration notes. D-64:
tools exist only for implemented REST — never for a proposal.

#### THE PROBLEM

Advertising what doesn't exist lets agents call operations that
aren't there; a decoupled version hides which REST contract the
tools map to.

#### OPTIONS CONSIDERED

1. **`tools/list` enumerates exactly the implemented tools** (11 at
   first; grows as D-39/D-40/D-41 freeze). Tool descriptions quote
   the REST operation each tool maps to. The server reports its own
   version and the v1 API version it targets; a tool list never
   advertises a tool whose REST operation is unimplemented or still
   a proposal. Breaking changes to a tool (renamed input, changed
   result shape) require a version bump and migration notes, per
   D-37's stability rule.
2. **Advertise proposed tools in `tools/list`.** Lets agents call
   operations that do not exist.
3. **Server version decoupled from API version.** Hides which REST
   contract the tools actually map to.

#### RECOMMENDATION

Option 1. Discovery is always truthful — `tools/list` is a mirror
of the implemented REST surface, and the version pair (server +
targeted v1) tells an agent exactly what contract it's talking to.
The bump-and-notes rule makes breaking changes visible before they
break agents.

#### IMPLICATIONS

- `tools/list` is generated from the implemented operation set, not
  hand-maintained.
- Tests assert the inventory matches exactly (no more, no fewer)
  and that descriptions name their REST operations.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-42](D-42-headless-mcp-server.md), [D-37](D-37-headless-first-api.md)
