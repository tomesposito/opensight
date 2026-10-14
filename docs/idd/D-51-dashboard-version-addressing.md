---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Decide how readers and embeds address dashboard versions in headless
v1.

## Scope

The default version for reads and embeds; the embed version
parameter; reader query constraints on frozen versions.

## Out of Scope

Dashboard identity (D-50); lifecycle/delete/retention (D-52);
reader/share access (D-53).

### 🚧 IDD D-51 — How are dashboard versions addressed?

#### CONTEXT

IDD D-38 ✅: versions store the definition only, never rendered
snapshots; keep every version by default. IDD D-40 ✅ approved option
2: reads gain version addressing with latest-published as the default,
never the draft; `Idempotency-Key` covers publish. What exists today:
embed URLs (`POST /dashboards/{id}/embed-url`) resolve against the
current definition with no version concept; the unversioned
`GET /dashboards/{id}/definition` returns the stored definition.

#### THE PROBLEM

When a reader or an embed asks for a dashboard without naming a
version, what do they get — and what may reader queries do?

#### OPTIONS CONSIDERED

1. Reads default to the latest published version, never the working
   draft. Embed URLs accept an optional version (default latest
   published); the unversioned `GET /dashboards/{id}/definition` keeps
   returning the dashboard asset's stored definition, which after
   publish is the latest published version. Reader queries run one
   visual of one frozen version with only declared control values;
   ad-hoc filters are rejected with a named `errorCode`.
2. Default-to-draft reads — readers see the working analysis state.
   Breaks D-38's immutable-version promise and makes shared links
   unstable.
3. Version-pinned-only reads — every read must name a version. Most
   explicit, but every link and embed must carry a version, and "just
   show me the dashboard" stops working.
4. Allowing reader-supplied ad-hoc filters — readers could filter
   beyond the built-in controls. Breaks D-38's "readers limited to
   built-in filters/controls".

#### RECOMMENDATION

Option 1. Latest-published as the default is what shared links and
embeds should resolve to; the draft is never accidentally exposed;
limiting reader queries to declared control values is D-38's consumer
contract enforced at the API boundary.

#### IMPLICATIONS

Once decided, reads and embeds resolve versions per the rule, the
visual-query endpoint validates control values against the frozen
version, and ad-hoc filters fail with a named `errorCode`.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-40](D-40-headless-dashboard-publishing.md), [D-38](D-38-dashboard-publish-semantics.md)
