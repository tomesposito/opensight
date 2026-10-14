---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-13
labels: [idd]
---

## Purpose

Resolve the product choices required to make the headless MCP server
an implementable v1 contract under D-37 and the frozen contract.

## Scope

MCP transport, credential carriage, tool scope, header-convention
mapping, query tool shape, error mapping, packaging, and
discovery/versioning for the v1 MCP server. How the MCP slice relates
to D-39 (analysis authoring), D-40 (dashboard publishing), and D-41
(asset management) where the contracts touch.

## Out of Scope

Analysis authoring verbs (D-39), dashboard publish semantics (D-38,
D-40), asset-management verbs (D-41), prepared-dataset sharing (HQ-4),
namespaces/users/groups/invitations/embedding/AI-admin versioning (a
later identity/admin slice), SDK/CLI generation from the spec (later
slices per D-37 sequencing), MCP prompts/resources (a later slice, if
ever), Streamable HTTP transport (a later slice), new SQL execution
capabilities, deployment and publishing this branch.

### 🚧 IDD D-42 — What MCP server contract should headless v1 expose?

#### CONTEXT

D-37 ✅ settled the shape: builder-shaped REST+OpenAPI first, MCP
second, SDK/CLI generated; no raw SQL through the API; user-level
tenant-scoped credentials via the operator invitation/minting path;
rate limiting on every route. The frozen contract settled the
conventions (`/api/v1/...`, secure refresh tokens,
`limit`/`cursor`/`nextCursor` pagination, composed dataset describe,
MCP as a mechanical 1:1 mapping of REST). The datasets and querying
slices are implemented (11 operations in
`docs/api/openapi-v1.yaml`, only one with an `operationId`).
Analyses (D-39), dashboards (D-40), and assets (D-41) are proposals
awaiting answers.

What exists today: no MCP code at all — no server package, no SDK
dependency, no transport. The v1 conventions the MCP server must
carry are header-based (`Limit`/`Cursor`, `Idempotency-Key`,
`If-Match`), and MCP tool calls have no native header concept. The
one existing `operationId` (`runDatasetQuery`) is camelCase while
D-37's examples and all three proposal slices use snake_case.

#### THE PROBLEM

Which transport, credential, scope, convention-mapping, error, and
packaging choices should the MCP server ship with, without inventing
a second API design, without creating a privileged path around the
REST contract, and without exposing a tool for any REST operation
that is still a proposal?

#### OPTIONS CONSIDERED

1. **Proposal-first, then implement (recommended).** This slice
   publishes a tool table for the 11 implemented operations plus
   eight questions (Q1–Q8 in `docs/headless-v1-mcp.md`) and waits
   for answers before any implementation — the same path D-39,
   D-40, and D-41 took. Cost: one more review round before agents
   get the native front door. Benefit: transport and credential
   handling — the two places where a wrong default opens a network
   listener or leaks an identity — get an explicit product call,
   and no deferred tool ships ahead of its REST operation.
2. **Implement now over the implemented REST.** Build the stdio
   server with the 11 tools directly, taking the proposal's
   recommendations as defaults. Cost: the transport and credential
   choices freeze silently, and the frozen contract's rule ("each
   slice needs its contract approved before its build branch") is
   broken for the slice where the security surface is largest.
   Benefit: no review round.
3. **Defer MCP until D-39/D-40/D-41 are answered.** Build the MCP
   server once, with all tools. Cost: the agent-native front door
   waits on three unrelated review gates, and the datasets/querying
   tools — fully specified by implemented REST — sit unused.
   Benefit: one combined review instead of two.

#### REASONING

Option 1. The MCP slice is where the API either keeps its "one
contract, many clients" promise or breaks it: a server that calls
route handlers in-process, accepts per-call credentials, or
advertises proposed tools would be a second, privileged API wearing
an MCP mask. Those are product calls, not implementation details,
and the D-39/D-40/D-41 precedent shows the review round is cheap —
Tom answers batched questions in one pass. Option 2 saves one round
by freezing exactly the choices (transport, credential carriage)
that most need a product call. Option 3 stalls the 11 fully
specified tools behind gates they do not depend on: the MCP
questions are answerable now, and the deferred tools follow their
slices' approvals mechanically, so no combined review is needed.

The proposal itself takes positions where the existing contract
already supplies the rule (mechanical 1:1 naming per freeze Q7;
server-as-just-another-API-client per D-37; no raw SQL; user-level
tenant-scoped credentials; named error codes; per-tenant rate
limiting; HQ-4 no data-access widening) and asks where it does not
(transport; credential carriage mechanics; header mapping; error
shape; packaging; discovery/versioning). Where a question belongs
to another slice — analysis verbs to D-39, publish/share semantics
to D-40, search/move/share verbs to D-41 — the proposal defers the
tool instead of answering it twice.

#### IMPLICATIONS

- Approval must answer Q1–Q8 in the slice proposal. The loop then
  records the approved contract and implements the MCP server
  package, the tool definitions, and the contract tests.
- The MCP server calls the v1 HTTP API only. No in-process handler
  reuse, no direct store access, no privileged path — ever.
- No MCP tool ships for an unversioned route or a proposal-only
  REST operation. `tools/list` advertises exactly the implemented
  tools.
- No implementation, no OpenAPI changes, no new dependencies, and
  no UI changes ship from this slice. Issue #95 stays open.
