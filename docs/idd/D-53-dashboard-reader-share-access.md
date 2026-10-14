---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Decide the reader and share access model for published dashboards in
headless v1.

## Scope

What data readers can see; whether share grants stay admin-managed;
anonymous-embed access.

## Out of Scope

Publish permission (D-48); HQ-4 prepared-dataset sharing (separate
decision); HQ-6 anonymous embedding (separate decision); the
delegated-data model as a future decision (recorded, not decided
here).

### 🚧 IDD D-53 — What can dashboard readers and share grants access?

#### CONTEXT

IDD D-40 ✅ approved option 2: readers get data only where they
independently have dataset access; the delegated model (option 3)
needs its own product decision and security proof and must not arrive
as a default. HQ-4 keeps prepared datasets owner-only for the pilot;
the existing `sharing.ts` grants are admin-only and definition-only.
What exists today: `GET|PUT|DELETE /dashboards/{id}/shares
(/user/{userId}|/group/{groupId})` — admin-only.

#### THE PROBLEM

When a dashboard is shared, does the share carry data access with it?

#### OPTIONS CONSIDERED

1. Readers see a published dashboard's definition and data only where
   they independently have access to the underlying datasets — a
   dashboard grant never authorizes another owner's prepared data
   (HQ-4, and the sharing.ts definition-only rule). Share grants stay
   admin-managed until a reader-access model is decided;
   anonymous-embed access follows HQ-6 and requires its own decision.
2. A published dashboard carrying the publisher's data authorization
   (delegation) — any permitted reader sees the publisher's data. The
   QuickSight-style shared-dashboard experience — but readers see
   data they cannot otherwise access, contradicting HQ-4's owner-only
   pilot; it needs its own security proof and must not be assumed.
3. A reader role with its own grant model — a new role beyond
   viewer/co-owner. A larger design than a default; belongs to a
   future access-model decision.

#### RECOMMENDATION

Option 1. It keeps the tenant boundary exactly where HQ-4 put it,
avoids inventing a reader-access model inside this slice, and leaves
delegation and the reader role as explicit future decisions rather
than silent defaults.

#### IMPLICATIONS

Once decided, dashboard reads enforce independent dataset access,
share grants remain admin-managed, and readers without dataset access
get the definition but no data.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-40](D-40-headless-dashboard-publishing.md), [D-37](D-37-headless-first-api.md)
