---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Decide how analyses bind datasets in headless v1.

## Scope

The binding declaration shape, typed legacy/prepared references,
resolution rules, and the fail-closed behavior for unresolvable or
cross-owner bindings. The exact binding JSON schema is pinned before
implementation.

## Out of Scope

Verb granularity/naming (D-43); access rules (D-44); HQ-4
prepared-dataset sharing (separate decision); new SQL execution
capabilities (forbidden by D-37).

### 🚧 IDD D-46 — Which datasets can new analyses bind?

#### CONTEXT

IDD D-39 ✅ approved option 2. Hosted embedded-console authoring saves
single-dataset definitions; v1 dataset queries use owner-private
prepared datasets that analysis metadata cannot currently reference.
HQ-4 keeps prepared datasets owner-only for the pilot. D-37 forbids
new SQL execution capabilities — bindings reference datasets, never
raw SQL.

#### THE PROBLEM

What may an analysis's dataset bindings reference, and under whose
authority are they resolved?

#### OPTIONS CONSIDERED

1. Explicit bindings keyed by dataset identifier, with typed
   legacy/prepared references. Prepared references are resolved as the
   authenticated owner only, with no sharing or grant-based data
   access. Every declaration must resolve before save; cross-owner
   queries/edits fail closed. The exact binding JSON schema is pinned
   before implementation; client tenant, user, or arbitrary ARN
   assertions cannot be execution authority.
2. Legacy-dataset-only authoring — follows the embedded path, but
   cannot author against the prepared datasets exposed by v1.
3. Prepared-only authoring — cannot round-trip imported legacy
   bindings.

#### RECOMMENDATION

Option 1. It lets agents author against both dataset kinds v1 exposes,
keeps the tenant boundary intact (owner-only resolution, fail-closed
cross-owner), and the explicit typed declaration gives validation
something concrete to check before save.

#### IMPLICATIONS

Once decided, the binding JSON schema is frozen, validation rejects
unresolvable or denied bindings on write, and supporting both kinds
requires the metadata-link work plus the security tests the slice
proposal names.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-39](D-39-headless-analysis-authoring.md), [D-37](D-37-headless-first-api.md)
