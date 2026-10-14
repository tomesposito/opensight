---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-14
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Decide how dashboards are identified relative to their source
analysis.

## Scope

The dashboard id scheme; the `SourceAnalysisId` link; whether one
analysis can publish many dashboards.

## Out of Scope

Version addressing (D-51); lifecycle/delete (D-52).

### ✅ IDD D-50 — What is a dashboard's identity?

#### DECISION (product owner, Tom, 2026-10-14)

Own id linked via SourceAnalysisId (one analysis can publish to many dashboards).


#### CONTEXT

IDD D-38 ✅: a dashboard is a read-only version of the analysis for
consuming; publishing freezes an immutable versioned definition.
IDD D-40 ✅ approved option 2: publish under the analysis, versions
under the dashboard. What exists today: `GET /dashboards/{id}/
definition` reads a QuickSight-shaped envelope; dashboard and
analysis ids live in separate namespaces.

#### THE PROBLEM

Is a dashboard its own asset, or is it the same thing as its source
analysis?

#### OPTIONS CONSIDERED

1. Publish creates a dashboard with its own id, linked to the source
   via `SourceAnalysisId`. One analysis can publish to many dashboards
   (per-audience variants); `dashboardId` in the publish body appends
   to an existing dashboard only when its source matches, else 409.
2. Dashboard id equals the analysis id (1:1). Simpler addressing —
   but no per-audience variants, and a confusing shared id across two
   asset kinds (draft vs published would share one identifier).

#### RECOMMENDATION

Option 1. Per-audience variants are the real use case (same analysis,
different filters/controls for different consumers); separate ids
keep the draft/published distinction unambiguous; the source-match
409 keeps republish honest.

#### IMPLICATIONS

Once decided, publish mints dashboard ids, stores `SourceAnalysisId`,
and enforces the source-match rule; reads address dashboards and
versions independently of analyses.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-40](D-40-headless-dashboard-publishing.md), [D-38](D-38-dashboard-publish-semantics.md)
