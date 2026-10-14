---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-14
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Decide the granularity and wire naming of the analysis authoring verbs
in headless v1.

## Scope

Which authoring operations v1 exposes (whole-definition CRUD vs
resource verbs for visuals, layouts, filter groups, and calculated
fields), write/read casing conventions, and how MCP names follow.

## Out of Scope

Who can call the verbs (D-44); conflict behavior (D-45); dataset
bindings (D-46); draft validity (D-47).

### ✅ IDD D-43 — What verb granularity and naming should analysis authoring use?

#### DECISION (product owner, Tom, 2026-10-14)

Approve the verb table: camelCase writes, existing PascalCase reads; MCP names follow the approved REST operations.


#### CONTEXT

IDD D-39 ✅ approved option 2: whole-definition CRUD plus resource
operations for visuals, layouts, filter groups, and calculated fields —
one analysis version, one validation path. The slice proposal
(`docs/headless-v1-analyses.md`) contains a proposed verb table. The
API describe shape today is PascalCase; UI mutations operate on
`BundleDefinition`. Freeze Q7 says MCP names follow REST mechanically,
so the REST naming decision must precede stable tool names.

#### THE PROBLEM

How fine-grained should the authoring verbs be, and what casing should
writes and reads use?

#### OPTIONS CONSIDERED

1. Approve the proposed verb table — resource verbs for visuals,
   layouts, filter groups, and calculated fields alongside
   whole-definition CRUD; camelCase writes, existing PascalCase reads.
   MCP names follow the approved REST operations mechanically.
2. Coarse CRUD only — whole-definition replacement for every edit;
   fine-grained verbs wait for a later slice. Simpler, but clients do
   document surgery for every change.
3. Individual layout/filter/calculation verbs beyond the proposed
   table — more builder-shaped, but more surface to specify, test,
   and keep consistent.
4. A single PascalCase wire shape — one casing everywhere instead of
   camelCase writes / PascalCase reads. Consistent, but rewrites the
   existing read convention.

#### RECOMMENDATION

Option 1. The proposed table is the granularity agents need to express
individual builder actions without inventing new verbs later; camelCase
writes match the v1 machine-first convention while PascalCase reads
preserve the existing describe shape; MCP then follows mechanically
under freeze Q7.

#### IMPLICATIONS

Once decided, the verb table is frozen in `docs/api/openapi-v1.yaml`
with contract tests; the implementation wires each verb to the shared
`BundleDefinition` validation path; MCP tool names are derived
mechanically from the approved REST operations.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-39](D-39-headless-analysis-authoring.md), [D-37](D-37-headless-first-api.md)
