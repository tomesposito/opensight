---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-13
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Resolve the product choices required to make headless dashboard
publishing an implementable v1 contract under D-37 and D-38.

## Scope

Publish and version addressing, who can publish, the clean-state rule,
dashboard identity, lifecycle (unpublish/delete/retention), reader and
share access, and the export shape.

## Out of Scope

Analysis authoring verbs (D-39), prepared-dataset sharing (HQ-4),
asset search/move/permission verbs (assets slice), MCP tool mapping
(mechanical 1:1 per freeze Q7), new SQL execution capabilities,
deployment and publishing this branch.

### ✅ IDD D-40 — What dashboard publishing contract should headless v1 expose?

#### DECISION (product owner, Tom, 2026-10-14)

Option 2 approved: publish under the analysis, versions under the
dashboard, with the access, lifecycle, and export semantics in the
slice proposal. The seven open questions below are now their own IDDs;
the dashboards implementation is gated on their answers.

- Q1 (who can publish) → [D-48](D-48-dashboard-who-can-publish.md)
- Q2 (clean state) → [D-49](D-49-dashboard-publish-clean-state.md)
- Q3 (dashboard identity) → [D-50](D-50-dashboard-identity.md)
- Q4 (version addressing) → [D-51](D-51-dashboard-version-addressing.md)
- Q5 (lifecycle) → [D-52](D-52-dashboard-lifecycle.md)
- Q6 (reader/share access) → [D-53](D-53-dashboard-reader-share-access.md)
- Q7 (export shape) → [D-54](D-54-dashboard-export-shape.md)

#### CONTEXT

D-38 ✅ settled what publish *means*: a dashboard is a read-only
version of the analysis for consuming — publishing freezes an immutable
versioned *definition* (layout, visuals, filters/controls), readers can
use only the filters/controls added at build time, data stays live, and
versions store the definition only, never rendered snapshots. Retention
keeps every version by default with an operator-configured cap allowed.
D-38 explicitly carried who-can-publish to the dashboards slice.

What exists today: `GET /dashboards` (list) and
`GET /dashboards/{id}/definition` (QuickSight envelope, GET-only) in
`packages/api/src/index.ts`; share grants
(`GET|PUT|DELETE /dashboards/{id}/shares(/user/{userId}|/group/{groupId})`)
in `packages/api/src/sharing.ts` — admin-only, definition-access only;
the UI's PUBLISH is an honest stub
(`packages/web/src/AuthorToolbar.tsx`); embed URLs
(`POST /dashboards/{id}/embed-url`) resolve against the current
definition with no version concept; report/snapshot machinery
(`packages/api/src/reports.ts`) has no dashboard-scoped endpoint.
`DefinitionStore` is a startup snapshot reader with no save or
versions. The analyses slice (D-39) is still 🚧, so publish's input —
the analysis — has no approved authoring or validation contract yet.

#### THE PROBLEM

Which publish, versioning, access, lifecycle, and export semantics
should agents receive as stable v1 behavior, without weakening the
tenant boundary (HQ-4 owner-only pilot) or inventing a reader-access
model the product owner has not approved?

#### OPTIONS CONSIDERED

1. Publish as a flag on the analysis, no versions. Readers always see
   the current draft. Simplest — but it contradicts D-38 outright
   (immutable versioned definitions) and gives shared links no
   stability. Rejected by D-38; listed only to record that it was
   considered and excluded.
2. Publish under the analysis, versions under the dashboard, with the
   access, lifecycle, and export semantics in the
   [slice proposal](../headless-v1-dashboards.md). One analysis can
   publish to many dashboards; reads default to the latest published
   version; readers get data only where they independently have
   dataset access; export is render-on-demand, never a stored snapshot.
3. Publish plus a reader role with delegated data access: a published
   dashboard carries the publisher's data authorization, so any
   permitted reader sees the publisher's data. This is the
   QuickSight-style shared-dashboard experience — but it lets readers
   see data they cannot otherwise access, which contradicts HQ-4's
   owner-only pilot and the definition-only sharing rule. It needs its
   own product decision and security proof; it must not arrive as a
   default inside this slice.

#### REASONING — adopted as the decision above (2026-10-14)

The product owner approved option 2. The loop's recommendation is
superseded by the decision; the per-question IDDs D-48–D-54 carry the
remaining calls. Option 1 remains excluded by D-38; option 3 remains a
future decision, not a silent default.

#### IMPLICATIONS

- **API contract:** publish becomes a mutation returning a version
  identifier; reads gain version addressing with latest-published as
  the default, never the draft. `Idempotency-Key` covers publish
  (retries return the original version, never a duplicate).
- **Draft vs. published:** the working analysis stays the draft; the
  dashboard's published versions are separate, immutable artifacts.
  Editing an analysis never rewrites a published version.
- **Storage and metering:** versions cost storage per publish — the
  keep-every-version default plus the operator cap compose with the
  HQ-14 metering foundation D-37 already committed to.
- **Embeds:** embed URLs gain version resolution (default latest
  published) instead of pointing at the live definition; the exact
  parameter is part of the review (Q4).
- **Dependencies:** Q1 (who can publish) and Q2 (clean state) must be
  re-derived from D-39 if D-39 lands a different access or validation
  model. Q6 (reader/share access) does not change HQ-4.

#### OPEN QUESTIONS — each now its own IDD (decided 2026-10-14)

The questions below were split into per-question IDDs D-48–D-54; the
original wording is preserved there. This section is kept for the
record.

1. Who can publish — build capability + co-owner access on the source
   analysis, administrator-only, or a separate publish grant?
2. Must the analysis be clean to publish — valid/executable required,
   drafts permitted with diagnostics, or a stricter clean state?
3. Dashboard identity — its own id linked via `SourceAnalysisId`
   (one analysis → many dashboards), or the dashboard id equals the
   analysis id (1:1)?
4. Version addressing and defaults — latest-published default, embed
   version parameter, reader queries limited to declared control
   values?
5. Lifecycle — no separate unpublish verb, per-version delete never
   removes the latest, source-analysis delete preserves published
   dashboards and severs the republish link, retention cap prunes
   oldest non-latest first?
6. Reader/share access — readers see data only where they
   independently have dataset access, or a delegated/published-data
   model (option 3)? Share grants stay admin-managed, or a reader
   role?
7. Export shape — render-on-demand formats and delivery (synchronous
   artifact vs. job-backed with polling)?

Related: [#95](https://github.com/tomesposito/opensight/issues/95),
[D-37](D-37-headless-first-api.md), [D-38](D-38-dashboard-publish-semantics.md),
[D-39](D-39-headless-analysis-authoring.md).
