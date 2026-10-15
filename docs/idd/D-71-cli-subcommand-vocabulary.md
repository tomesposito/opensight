---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve the CLI's command vocabulary for headless v1.

## Scope

Subcommand and argument naming for the `opensight` CLI over the frozen
v1 REST contract. Everything the CLI can do maps to an existing v1
operation — no invented API calls.

## Out of Scope

Output format (D-72), credential carriage (D-73), packaging (D-74),
generated vs hand-authored command layer (D-75).

### 🚧 IDD D-71 — What should the CLI's subcommand vocabulary be?

#### CONTEXT

D-37 ✅ commits to a CLI (`opensight dataset create ...`) as a delivery
shape generated from the spec, after REST+OpenAPI and MCP. Freeze Q7 made
MCP tool names a mechanical 1:1 mapping of REST operations (D-42 ✅,
D-62 ✅); D-43 ✅ fixed camelCase writes / PascalCase reads for the
analyses verbs. The CLI is the third surface on the same contract, so
its naming should follow the same mechanical-mapping principle —
unless a human-facing vocabulary earns its own design.

#### THE PROBLEM

Agents will drive the CLI as much as humans. A vocabulary that invents
its own action verbs ("list-datasets", "run-sql" — and raw SQL is
forbidden by D-37 decision 2 anyway) creates a second design to learn
and maintain; a vocabulary that mirrors the REST resources stays
predictable and keeps the OpenAPI coverage guard meaningful.

#### OPTIONS CONSIDERED

1. **Resource-noun subcommand tree, mirroring REST.** Noun groups with
   CRUD-ish verbs: `opensight dataset list|describe|query|refresh`,
   `opensight analysis add-visual ...`, `opensight dashboard publish`,
   `opensight asset move|copy|delete`. Arguments named after the
   operation's wire params (camelCase), identifiers positional where
   unambiguous (`dataset describe <id>`).
2. **Action-first verbs.** Flattened verbs like `opensight list-datasets`,
   `opensight run-query`, `opensight publish-dashboard` — each a named
   script rather than a tree. Friendlier to type from memory, but a
   second vocabulary that drifts from REST naming over time.
3. **REST-path passthrough.** `opensight v1 POST /datasets/{id}/query
   --body ...` — maximally mechanical, zero invention. Unusable by
   humans; the "CLI for humans" half of D-37's purpose dies.

#### RECOMMENDATION

Option 1. The mechanical mapping (REST → MCP tools → SDK methods → CLI
subcommands) is the whole point of the v1 contract discipline: one
vocabulary learned once, used everywhere. An agent that knows the
OpenAPI operations can guess the CLI command, and the SDK/API coverage
guard extends to the CLI naturally.

#### IMPLICATIONS

- CLI grammar documents as the REST operation table rendered into a
  tree; no separate CLI naming spec to keep in sync.
- Where a v1 operation has no sensible subcommand shape (e.g. `POST
  /assets/search`), the CLI uses the noun-tree form anyway
  (`asset search --name ...`) rather than inventing a verb.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-37](D-37-headless-first-api.md), [D-42](D-42-headless-mcp-server.md), [D-43](D-43-analysis-verb-granularity-naming.md), [D-62](D-62-mcp-transport.md)
