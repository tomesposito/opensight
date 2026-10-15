---
status: ✅ Confirmed (product owner, 2026-10-14)
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve how much of the CLI is generated from the OpenAPI spec.

## Scope

The build strategy for `@opensight/cli`'s command surface: fully
generated from `docs/api/openapi-v1.yaml`, hand-authored, or a
generated core with a hand-maintained UX layer. Follows D-37 ✅
("SDK/CLI generated") and the anti-invention guards the SDKs carry.

## Out of Scope

Subcommand vocabulary (D-71), output format (D-72), credential
carriage (D-73), packaging (D-74).

### ✅ IDD D-75 — How much of the CLI is generated from the spec?

#### CONTEXT

D-37 ✅ says "SDK/CLI generated from the spec" — the TS SDK
(`packages/headless-sdk`) and Python SDK (`packages/headless-sdk-python`)
both carry an anti-invention guard: a test parses
`docs/api/openapi-v1.yaml` and fails if any spec route is unmapped or
any client entry covers a route not in the spec. The MCP tools were
"generated mechanically from implemented OpenAPI operations" with a
spec-only alignment commit for operationIds. So the codebase already
treats "generated from the spec" as a spectrum, not a binary.

#### THE PROBLEM

Fully generating argument parsing from OpenAPI is real machinery (a
codegen step, committed generated output, regeneration discipline) —
heavy for a CLI whose first version covers ~53 operations. A fully
hand-authored layer risks drift: a new v1 operation lands in the spec
but the CLI silently doesn't expose it, and no test notices.

#### OPTIONS CONSIDERED

1. **Generated operation table, hand-authored UX layer.** The
   command list, argument names/types, and required flags derive
   from `operationId` + parameters in `openapi-v1.yaml` (same
   mechanical mapping as the MCP tools, same D-71 noun-tree
   rendering); human affordances — table formatters for
   `--format table`, help text, shell completion — are hand-written.
   A coverage test extends the SDK guard: every spec operation has a
   CLI command, and no CLI command covers a non-spec operation.
2. **Fully hand-authored.** Fastest first version; the coverage test
   still guards drift, but every new operation needs a hand-written
   command and review catches only what's tested.
3. **Fully generated, committed output.** Maximum spec fidelity;
   the CLI's internals become build artifacts with their own review
   cost, and the repo's "read the diff" culture pays for generated
   noise on every spec change.

#### RECOMMENDATION

Option 1. It delivers D-37's "generated" promise where it matters —
the operation surface can never drift from the spec by construction —
while keeping the human-facing layer (tables, help, completion)
readable and reviewable. Same philosophy as the MCP slice's
mechanical mapping, applied one layer up.

#### IMPLICATIONS

- A new v1 operation appears in the CLI by regenerating the
  operation table; the coverage test fails loudly if it doesn't.
- Help text and formatters stay hand-maintained docs-quality prose,
  not codegen output.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-37](D-37-headless-first-api.md), [D-42](D-42-headless-mcp-server.md), [D-71](D-71-cli-subcommand-vocabulary.md)
