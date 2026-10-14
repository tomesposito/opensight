---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-14
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Decide who may publish a dashboard in headless v1.

## Scope

The publish permission rule; whether publishing needs its own grant;
grants/placement handling through publish.

## Out of Scope

Analysis authoring access (D-44, which this mirrors); clean-state
rule (D-49); dashboard identity (D-50).

### ✅ IDD D-48 — Who can publish a dashboard?

#### DECISION (product owner, Tom, 2026-10-14)

Build capability + co-owner access on the source analysis.


#### CONTEXT

IDD D-38 ✅ settled what publish means: a dashboard is a read-only
version of the analysis for consuming — publishing freezes an immutable
versioned definition (layout, visuals, filters/controls), data stays
live. IDD D-40 ✅ approved option 2: publish under the analysis,
versions under the dashboard. D-38 explicitly carried who-can-publish
to the dashboards slice. This question depends on D-44 (D-39 Q2): if
D-44 lands a different access model, this rule must be re-derived
from it.

#### THE PROBLEM

Which callers may publish a dashboard from an analysis?

#### OPTIONS CONSIDERED

1. Build capability + co-owner access on the source analysis,
   mirroring the D-44 proposal. Grants/placement cannot be
   overwritten through publish.
2. Administrator-only publish — only administrators can ship
   dashboards. Simplest, but publishing becomes an operator action
   rather than an authoring action.
3. A separate publish grant — a distinct permission for publishing,
   independent of co-owner access. Most flexible, but a new access
   model needing its own specification.

#### RECOMMENDATION

Option 1. It keeps publishing an authoring action (whoever can build
the analysis can ship it), mirrors the access model agents already
learn for analyses, and the no-overwrite rule keeps publish from
becoming a privilege-escalation path.

#### IMPLICATIONS

Once decided, publish enforces the rule and returns the version
identifier; if D-44 lands differently, this rule is re-derived rather
than shipped as-is.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-40](D-40-headless-dashboard-publishing.md), [D-44](D-44-analysis-authoring-access.md), [D-37](D-37-headless-first-api.md)
