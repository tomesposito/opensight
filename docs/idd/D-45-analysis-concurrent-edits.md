---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-14
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Decide the conflict model for concurrent analysis edits in headless v1.

## Scope

The unit of versioning for analyses, the If-Match precondition behavior
and error codes, and what happens to dependent visuals, filters, and
calculations on mutation.

## Out of Scope

Verb granularity/naming (D-43); access rules (D-44); dataset bindings
(D-46).

### ✅ IDD D-45 — How should concurrent analysis edits behave?

#### DECISION (product owner, Tom, 2026-10-14)

One version for the entire analysis; every update/subresource mutation/delete requires its current If-Match; the loser conflicts and must reread/reapply.


#### CONTEXT

IDD D-39 ✅ approved option 2: one analysis version, one validation
path. The slice proposal recommends the existing quoted-integer
ETag/If-Match convention. There is no silent cascading removal of
dependent visuals, filters, or calculations today; dangling references
reject the mutation.

#### THE PROBLEM

When two writers edit the same analysis concurrently, who wins and how
does the loser recover?

#### OPTIONS CONSIDERED

1. One version for the entire analysis; every update, subresource
   mutation, and delete requires its current `If-Match`. One of two
   edits based on the same version succeeds; the other conflicts and
   must reread/reapply. Missing precondition returns 428
   `V1_IF_MATCH_REQUIRED`, malformed returns 400
   `V1_IF_MATCH_INVALID`, stale versions use 409 `METADATA_CONFLICT`.
   Successful edits increment once. Dangling references reject the
   mutation.
2. Per-visual versions — each visual (or child resource) carries its
   own version, so unrelated edits never conflict. More concurrent
   writes, but the unit of consistency changes and whole-analysis
   coherence needs a separate story.
3. Automatic merging of unrelated edits — the server merges
   non-overlapping changes. Most permissive, but introduces merge
   semantics, conflict resolution rules, and a retry behavior agents
   cannot predict.

#### RECOMMENDATION

Option 1. A single analysis version keeps the consistency story agents
can reason about (one number, one retry loop), reuses the existing
quoted-integer ETag convention, and makes conflict recovery explicit
rather than hiding it inside server-side merges.

#### IMPLICATIONS

Once decided, every authoring mutation requires `If-Match` and returns
the named error codes; contract tests cover the 428/400/409 paths;
batch changes preserve consistency with the single version.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-39](D-39-headless-analysis-authoring.md), [D-37](D-37-headless-first-api.md)
