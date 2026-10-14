---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Decide whether agents may save incomplete analyses in headless v1.

## Scope

Whether empty sheets, incomplete field wells, and non-executable
visuals can be persisted; validation diagnostics; the hard lines
(calculations, bindings).

## Out of Scope

Verb granularity/naming (D-43); conflict behavior (D-45); dataset
binding declarations (D-46); dashboard publish clean-state (D-49 —
what may be published, not what may be saved).

### 🚧 IDD D-47 — Can agents save unfinished analysis drafts?

#### CONTEXT

IDD D-39 ✅ approved option 2. UI mutations operate on
`BundleDefinition` and allow incremental construction — the UI itself
builds analyses step by step. The slice proposal draws the line at
permissive persistence with strict validity: diagnostics for what is
not yet executable, hard rejection for what must never be stored.

#### THE PROBLEM

Should the API admit analyses that are not yet executable, so agents
can build incrementally?

#### OPTIONS CONSIDERED

1. Permit empty sheets and incomplete field wells that the UI can
   represent, but return validation diagnostics for non-executable
   visuals. Never admit invalid calculations or unresolved/denied
   dataset bindings.
2. Require every visual to be executable before saving — the analysis
   is always in a runnable state. Simpler validity story, but agents
   cannot build incrementally; every save must be a finished product.
3. Preserve additional opaque imported features as read-only content —
   imported definitions round-trip features v1 cannot author. More
   faithful round-tripping, but the API carries content it cannot
   validate or edit.

#### RECOMMENDATION

Option 1. Agents build incrementally like the UI does; diagnostics
make non-executable state visible instead of silent; the hard lines
(no invalid calculations, no unresolved/denied bindings) keep the
fail-closed boundary exactly where D-37 and HQ-4 put it.

#### IMPLICATIONS

Once decided, the validation path returns diagnostics on
non-executable visuals while writes still reject invalid calculations
and bad bindings; D-49 decides separately whether drafts may be
published.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-39](D-39-headless-analysis-authoring.md), [D-37](D-37-headless-first-api.md)
