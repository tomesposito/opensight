---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Decide the dashboard export contract in headless v1.

## Scope

Export formats and delivery — synchronous artifact vs job-backed with
polling; which formats v1 commits to.

## Out of Scope

Snapshot/export of analyses (not in scope); the report machinery's
existing email HTML (existing behavior, not redesigned here).

### 🚧 IDD D-54 — What export shape should dashboards offer?

#### CONTEXT

IDD D-38 ✅: versions store the definition only, never rendered
snapshots — so export renders on demand from a frozen version against
live data. IDD D-40 ✅ approved option 2: export is render-on-demand,
never a stored snapshot. The existing report machinery
(`packages/api/src/reports.ts`) covers email HTML; PDF/CSV shapes are
not assumed. The slice proposal names `POST /dashboards/{id}/exports`
with `{ version?, format }`.

#### THE PROBLEM

What formats can agents export, and does the export come back inline
or as a polled job?

#### OPTIONS CONSIDERED

1. Render-on-demand from a frozen version against live data.
   Proposed: `POST /dashboards/{id}/exports` with
   `{ version?, format }`; formats and delivery to be decided —
   synchronous artifact for the simple case, job-backed with polling
   (reusing the durable-jobs machinery) for large ones.
2. Synchronous-only export — the artifact comes back inline. Simple,
   but caps artifact size and risks timeouts on large dashboards.
3. Job-only export — every export is a polled job. Uniform, but
   complicates the simple case (a small PDF needs two calls and a
   wait).
4. Stored-snapshot export — export a pre-rendered snapshot.
   Contradicts D-38 (versions never store rendered snapshots).

#### RECOMMENDATION

Option 1. Render-on-demand is D-38's direct consequence; deciding
formats and delivery per format keeps the simple case simple while
the durable-jobs machinery handles the large case; stored snapshots
are excluded by D-38.

#### IMPLICATIONS

Once decided, the export endpoint renders the named frozen version
against live data, formats and delivery behavior are recorded per
format, and no rendered snapshots are ever stored.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-40](D-40-headless-dashboard-publishing.md), [D-38](D-38-dashboard-publish-semantics.md)
