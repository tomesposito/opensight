---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-14
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Decide whether an analysis must be valid to publish in headless v1.

## Scope

The publish-time validity requirement; what "valid" means; what
readers see if drafts can publish.

## Out of Scope

What may be saved as a draft (D-47 — saving is separate from
publishing); analysis validation internals (defined by the approved
analyses contract).

### ✅ IDD D-49 — Must the analysis be clean to publish?

#### DECISION (product owner, Tom, 2026-10-14)

Drafts permitted with diagnostics.


#### CONTEXT

IDD D-38 ✅: publishing freezes an immutable versioned definition;
readers use only built-in filters/controls; data stays live. IDD D-40
✅ approved option 2. This question depends on the analyses
validation semantics: "valid" reuses whatever validation the approved
analyses contract defines — this slice does not invent a second
validator.

#### THE PROBLEM

Can agents publish a draft analysis, or must it be valid and
executable first?

#### OPTIONS CONSIDERED

1. Publish requires a valid, executable analysis; failures return
   validation diagnostics and publish nothing. "Valid" reuses the
   approved analyses contract's validation.
2. Permit publishing drafts with diagnostics — readers see partial or
   broken visuals, with the diagnostics available. Agents can publish
   incrementally, but published artifacts can be broken.
3. A stricter clean state — e.g. valid and warning-free. Strongest
   guarantee for readers, but warnings that are harmless for authors
   block publishing.

#### RECOMMENDATION

Option 1. Published dashboards are immutable and shared — the validity
gate belongs at publish time, not read time; reusing the analyses
contract's validation avoids a second, drifting validator; diagnostics
on failure tell the agent exactly what to fix.

#### IMPLICATIONS

Once decided, publish validates before writing any version and
returns diagnostics on failure; D-47's draft-saving stays independent
— drafts can exist, they just cannot publish.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-40](D-40-headless-dashboard-publishing.md), [D-47](D-47-analysis-unfinished-drafts.md), [D-38](D-38-dashboard-publish-semantics.md)
