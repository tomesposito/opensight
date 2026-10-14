---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Decide the access rules for analysis authoring in headless v1.

## Scope

Who may create, edit, and delete analyses; the co-owner grant on
creation; asset+folder restriction behavior; the compatibility rule
for imported analyses with absent grants.

## Out of Scope

Verb granularity/naming (D-43); conflict behavior (D-45); dataset
bindings (D-46); HQ-4 prepared-dataset sharing (separate decision).

### 🚧 IDD D-44 — Who can create, edit, and delete analyses?

#### CONTEXT

IDD D-39 ✅ approved option 2. Hosted embedded-console authoring
already saves single-dataset definitions with co-owner/folder grants —
existing behavior supplies evidence, not permission to silently freeze
new semantics. Read access today is governed by `canRead`/`grantsAllow`:
analyses need the `build` capability, folder and asset grants must both
allow, undefined grants mean inherited access, administrators pass
through. HQ-4 keeps prepared datasets owner-only: an analysis grant
never authorizes another owner's prepared dataset.

#### THE PROBLEM

Which callers may create, edit, and delete analyses through v1?

#### OPTIONS CONSIDERED

1. Create requires the build capability; new analyses grant the creator
   co-owner access. Edit/delete require build capability and co-owner
   access through both asset and folder restrictions, preserving
   existing administrator behavior. Grants/placement cannot be
   overwritten through definition bodies. Imported analyses with absent
   grants follow the existing embedded-console behavior.
2. Administrator-only writes — only administrators can create, edit,
   or delete. Simplest to reason about, but blocks agent collaboration
   for non-admin authors.
3. A new owner-private analysis model — analyses are private to their
   creator by default. Different collaboration behavior from the
   embedded console's co-owner model.

#### RECOMMENDATION

Option 1. It mirrors the embedded console's proven model, gives agents
a real authoring path without inventing a new identity scheme, and
keeps the fail-closed boundary (grants/placement not overwritable
through definition bodies). The embedded-console compatibility rule
avoids silently re-deciding imported analyses.

#### IMPLICATIONS

Once decided, the access rule is enforced on every authoring route and
recorded in the contract; D-48 (who can publish) is derived from this
model; the review must settle the experience when a permitted analysis
editor cannot access its bindings (D-46).

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-39](D-39-headless-analysis-authoring.md), [D-37](D-37-headless-first-api.md)
