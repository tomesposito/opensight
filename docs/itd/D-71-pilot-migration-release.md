---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-15
labels: [itd]
---

## Purpose

Deploy the merged pilot release without treating incompatible contracts as a routine
code update.

## Scope

A bounded operator-controlled SR2-to-SR3 migration, immutable artifact promotion and
handoff to the existing private compatible-release workflow.

## Out of Scope

General infrastructure automation, data restore, bulk queue recovery and #96 cleanup.

### ✅ ITD D-71 — How do we promote this pilot's additive migration?

#### CONTEXT

The operator explicitly requested deployment. The current private CI correctly
rejects the candidate's changed contract digest. SR3 supplies transactional additive
DDL, but its release templates do not execute maintenance or migration. Initial
activation commands are deliberately unsuitable for an already-used database.

#### THE PROBLEM

A release must migrate the real database and record its resulting configuration
without bypassing the private compatibility guard or rebuilding public artifacts.

#### OPTIONS CONSIDERED

1. A narrow, tested, temporary operator migration bridge with strict pilot-state
   preconditions, independent records and an exact attested release. Selected.
2. Relabel the current compatibility digest and dispatch ordinary CI. Rejected:
   that records compatibility before proving the migration and runtime change.
3. Wait for the complete generic infrastructure/restore executor. Useful future
   work, but broader than the operator's requested additive pilot deployment.

#### REASONING

The pilot has no artifact versions left in its managed prefixes and its retained
cleanup events have expired. The bridge must recheck these conditions after drain;
it refuses active jobs, work or artifact references. This permits an honest bounded
backup inventory, preserves the stranded obligations and requires only the three
new execution tables plus existing runtime grants. It does not invent a general
restore protocol or erase old storage charges.

#### IMPLICATIONS

Use the existing conditional operation lock and private encrypted storage. Bind
every maintenance command to one plan, operation and epoch; register a seven-day
Aurora snapshot and key/audit/inventory evidence before DDL. Advance epoch rather
than reviving stale work. Fail closed on interruption or conflicting receipts.

Promote the already-attested image/frontend, then commit their actual source,
compatibility and configuration together. The existing private workflow remains
unchanged and can verify the resulting baseline. The temporary function and its
role are removed after acceptance. Public documentation contains only sanitized
evidence; operational settings, records and secret references stay private.
