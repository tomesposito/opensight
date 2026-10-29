---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-28
labels: [idd]
---

## Purpose

Record the product owner's 2026-10-28 decision supplied with issue #155.
This records the decision; it does not reopen it.

## Scope

Hosted reader access to published dashboards using publisher-owned prepared datasets.

## Out of Scope

Scheduled rendering, embeds, and changes to the separate local prep identity model.

### ✅ IDD D-85 — How should readers access a publisher's prepared dashboard?

#### CONTEXT

HQ-4 established an owner-only pilot and named share-the-recipe as its next
step, conditional on engineering security proof. D-53 separates dashboard
definition access from independent data authorization. The owner-only check
currently prevents readers with their own source access from using published
prepared dashboards.

#### THE PROBLEM

How can a reader use a published prepared dashboard without inheriting its publisher's data authorization?

#### OPTIONS CONSIDERED

1. Retain the pilot owner-only boundary.
2. ✅ **Share the recipe and execute every input under the reader's authorization.**

#### REASONING

1. Owner-only execution preserves the pilot boundary but prevents the reader
   workflow even when the reader independently holds all required source access.
2. Share-the-recipe preserves independent source authorization while allowing
   the published dashboard workflow. The accepted cost is re-execution under
   the reader identity and a required security proof across joins, aggregation,
   tenant boundaries, revocation and prepared/cache reuse.

#### IMPLICATIONS

Issue #155 must check every transitive source and deny the complete request
with `DASHBOARD_DATASET_ACCESS_DENIED` when any input is unauthorized or the
recipe cannot be safely re-executed. Publisher-materialized rows cannot be
served to readers. Owner behavior, scheduled rendering identities and HQ-4's
protected-pipeline embed refusal remain unchanged. The implementation and
tests are documented in [the issue guide](../issue-155-reader-prepared-access.md).
