---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Decide the lifecycle semantics for dashboards and their versions in
headless v1.

## Scope

Unpublish, dashboard delete, per-version delete, source-analysis
delete, and retention pruning.

## Out of Scope

Version addressing (D-51); reader/share access (D-53); export (D-54);
analysis delete semantics (owned by D-44/D-45, restated here only
where the contracts touch).

### 🚧 IDD D-52 — What is the dashboard lifecycle?

#### CONTEXT

IDD D-38 ✅: publishing freezes an immutable versioned definition;
keep every version by default, operator cap allowed. IDD D-40 ✅
approved option 2. Deletes preserve already-published dashboard
definitions per D-38. Retention composes with the HQ-14 metering
foundation D-37 committed to.

#### THE PROBLEM

How do dashboards and their versions end — unpublish, delete, prune
— and what survives the source analysis being deleted?

#### OPTIONS CONSIDERED

1. No separate unpublish verb in v1: deleting a dashboard removes it
   and all versions. Per-version delete prunes under the operator cap
   but never the latest version — deleting the latest requires
   deleting the dashboard. Deleting the source analysis preserves
   already-published dashboards (they are independent frozen
   definitions) and severs the republish link; republishing a deleted
   analysis fails closed. Retention: keep every version by default per
   D-38; the operator cap prunes oldest non-latest versions first.
2. A distinct unpublish verb — hide without deleting. More states to
   specify (hidden vs deleted, re-publish of hidden), for a use case
   delete already covers.
3. Deleting dashboards with their source analysis — cascade delete.
   Destroys published work readers may depend on; contradicts D-38's
   independent frozen definitions.
4. A keep-N default — cap versions from the start. Changes the audit
   story and the storage bill before either is measured.

#### RECOMMENDATION

Option 1. Published dashboards are independent artifacts — their
survival must not depend on the source analysis; never deleting the
latest via per-version delete keeps the version chain intact;
keep-every-version with oldest-first pruning under the cap is the
cheapest correct retention story.

#### IMPLICATIONS

Once decided, dashboard delete removes all versions, per-version
delete enforces the never-latest rule, source-analysis delete severs
the republish link, and retention prunes oldest non-latest first under
the operator cap.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-40](D-40-headless-dashboard-publishing.md), [D-38](D-38-dashboard-publish-semantics.md)
