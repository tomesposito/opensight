---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-10
labels: [itd]
---

## Purpose

Keep serverless cached results current without idle database work.

## Scope

Technical implementation of H9/H10 invalidation for the authorized deployment.

## Out of Scope

Changing source permissions, cache freshness semantics or upload experience.

### ✅ ITD D-29 — How should manifests reject stale descendants without an idle worker?

#### CONTEXT

H1 already advances namespace revisions atomically with metadata edits. SR2a
advances resource generations under the same SQL authority used for publication.
SR2b retains cached-input timestamps. D-23 proposed a durable descendant walk,
but that adds work dispatch and recovery for every invalidation in a deployment
whose database should sleep when unused.

#### THE PROBLEM

How can every artifact read reject obsolete dependencies without maintaining a
background descendant walker?

#### OPTIONS CONSIDERED

1. Block a namespace and walk descendants through durable events.
2. ✅ **Store the complete dependency certificate with each manifest and validate
   it inside the reader's authoritative SQL transaction.**
3. Trust invalidation notifications and locally cached readiness.

#### REASONING

Option 2 follows the existing fail-closed read contract with fewer moving parts.
A certificate includes all directly and transitively consumed artifact generations,
their original refresh timestamps, and the source/recipe definition versions.
Namespace revisions cover metadata edits; SQL time covers upload expiry. Starting
a refresh advances its claim and removes readiness atomically, so old descendants
fail their next check even when notifications are lost. Certificate size and SQL
work consume the existing bounded execution/memory envelope.

Option 1 is suitable if measured graphs make these reads too expensive, but is
unnecessary for the initial tester workload. Option 3 cannot preserve authority
after lost notifications or process replacement. This decision changes the
implementation of invalidation, not which stale results must be denied.

#### IMPLICATIONS

Implement [SR2c](../phase5-sr2c-manifests.md). Only SQL-validated, locally branded
manifest reads can contribute dependency certificates to a new manifest. Merge
the transitive certificates rather than trusting caller-submitted timestamps.
Recheck the whole certificate before ready publication, after hydration and before
result publication. Retain the previous immutable object records for later GC and
backup pins, while removing their readable authority at refresh admission.

No periodic invalidation poll, pub/sub dependency or namespace reopening operation
is needed. H1 outbox events remain atomic evidence and optional eviction hints.
H3 full-graph permissions still run before cache access; a certificate is never
an authorization substitute. Oversize certificates fail with a named budget error.
