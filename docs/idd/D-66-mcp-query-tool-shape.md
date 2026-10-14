---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve how `InteractiveQuery` schemas reach MCP tool inputs.

## Scope

The `run_dataset_query` input schema source; result-size behavior.

## Out of Scope

Raw SQL (rejected by D-37 decision 2 — never proposed). Query
execution budgets (existing hosted budgets — unchanged).

### 🚧 IDD D-66 — What shape should the MCP query tool take?

#### CONTEXT

D-42 ✅ approved proposal-first; this is its Q5. D-37 decision 2: no
raw SQL through the API — agents run the dataset's SQL with
parameterized filters only. The query body is the existing
`InteractiveQuery` (dimensions, measures, filters, parameter
declarations/bindings); SQL strings, envelopes, extra properties,
and unrecognized operators fail with named errors. Results are
`{ columns, rows }`; query results are not paginated. D-37 decision
3: SDK/CLI generated from the same contract.

#### THE PROBLEM

Hand-written tool schemas drift from the OpenAPI spec and become a
second contract; invented truncation would silently return partial
results to agents.

#### OPTIONS CONSIDERED

1. **Tool input schemas generated mechanically from the OpenAPI
   request schemas** (the same source SDK/CLI generation will use).
   `run_dataset_query` takes `{ id, query: InteractiveQuery,
   idempotencyKey? }` where `query` validates against the OpenAPI
   query schema — SQL strings, envelopes, extra properties, and
   unrecognized operators fail the same way REST rejects them.
   Result size follows the existing hosted execution budgets; the
   server invents no truncation or chunking (a result that exceeds
   budget fails with the REST error, not a silent partial).
2. **Hand-written tool schemas.** Drift from the OpenAPI spec — a
   second contract to keep in sync by hand.
3. **Invented truncation/chunking.** Silently returns partial query
   results to agents — the worst failure mode for a data API.

#### RECOMMENDATION

Option 1. One schema source for REST, SDK, CLI, and MCP — the "one
contract, many clients" promise made concrete. Budget overruns fail
loudly with the REST error, never silently, so an agent always
knows when it didn't get everything.

#### IMPLICATIONS

- Tool schemas are generated from `docs/api/openapi-v1.yaml` at
  build/test time; the query tool inherits REST's validation
  exactly.
- Tests assert SQL-string / envelope / extra-property / unknown-
  operator rejection parity with REST.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-42](D-42-headless-mcp-server.md), [D-37](D-37-headless-first-api.md)
