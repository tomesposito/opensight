---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-31
labels: [itd]
---

## Purpose

Deploy the authorized governed asset upgrade while retaining accepted cleanup
obligations and their protection windows.

## Scope

The additive resource kind/owner constraint upgrade on an already-current
registered metadata inventory, with an unchanged cleanup execution protocol.

## Out of Scope

Restore, arbitrary schema transitions, early deletion, queue redrive, mail
replay, changes to retention or quotas, and the ordinary CI compatibility guard.

### ✅ ITD D-87 — How can additive constraint maintenance preserve scheduled cleanup?

#### CONTEXT

The production preflight found future object-cleanup obligations whose retention
windows remain open. The attested candidate changes resource constraints but
does not change the dispatch, execution, collector or object-protection code.
The registered migration already verifies preservation of every retained table.
The operator requested completion of the latest deployment, including necessary
implementation work.

#### THE PROBLEM

How can this additive upgrade proceed without deleting protected objects or
invalidating accepted cleanup events?

#### OPTIONS CONSIDERED

1. Wait for all cleanup windows and executions to finish. Safe, but new normal
   activity creates more future obligations and can indefinitely defer maintenance.
2. Advance the epoch and rewrite or discard old events. Rejected: it changes
   durable authority and requires a separate transfer/recovery protocol.
3. Preserve the epoch for this bounded additive transition after complete
   invocation quiescence. Selected, with the restrictions below.

#### REASONING

The shared operation lock, zero runtime admission, disabled mappings and complete
hard-timeout drain exclude old executors during DDL. Keeping both epoch records
unchanged preserves the authority of existing schedules and queue messages.
The registered backup pins retained versions, and the migration's table checks
prove that pending events, attempt/fence counters and references survive exactly.
The unchanged cleanup protocol can then resume under the promoted runtime.

#### IMPLICATIONS

This narrowly updates D-80's epoch-advance requirement for this transition only.
Bind the temporary owner plan to the exact current release/configuration,
independent epoch checksum and complete pending-cleanup inventory checksum.
Require the current registered table inventory and only future, dispatched,
unclaimed `object-cleanup` events at the current epoch. Refuse active admissions,
operations, uploads, jobs, deliveries, prepared intents and any other obligation.
Recheck the inventory before freeze and reopen, and fail closed on changes.

Freeze SQL at the existing epoch only after external drain. Advance registry
revision and preserve its existing epoch, backup history, tombstones, retired
keys and fence high-water mark. Register the encrypted snapshot and object pins
before DDL. Require the ordinary migration receipt and exact idempotent retry,
verified new constraints/grants, matching runtime/frontend/edge promotion and
the independent watchdog before reopening. Leave schedules and queues untouched.
Remove temporary authority after hosted acceptance and fresh release read-back.

Rehearsals must prove same-epoch freeze/migrate/reopen, unchanged cleanup rows
and object references, backup-history preservation, denial of changed/early/
claimed/non-cleanup work or changed epoch authority, and transactional rollback.
This exception never relaxes the compatible controller or authorizes restore.
