---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-08
labels: [itd]
---

## Purpose

Record the locked Issue #54 decision for local draft auto-save and manual
checkpoint precedence.

## Scope

Browser draft persistence, save-kind timestamps and stale auto-save rejection.

## Out of Scope

Hosted persistence, collaborative editing, version history and cross-tab merges.

### ✅ ITD D-17 — How should auto-save coexist with manual draft checkpoints?

#### CONTEXT

Author currently stores one draft per entry in a synchronous localStorage
collection. Authors must explicitly save to retain edits through reload.
Within an editing session, the in-memory draft builds on the last manual
checkpoint: later edits carry its content forward, including intentional
changes and deletions. A separate tab can manually save the same entry while
the first tab has a pending auto-save.

#### THE PROBLEM

How should local auto-save preserve current work while respecting a newer
manual checkpoint from another tab?

#### OPTIONS CONSIDERED

1. Store separate manual and auto-save snapshots per entry.
2. ✅ **Keep one stored copy with manual/auto timestamps and reject auto-save against a newer unseen manual checkpoint.**
3. Let every write replace the entry without checking the manual timestamp.

#### REASONING

Option 1 supports rollback but duplicates definitions and introduces snapshot
selection and quota costs. The required recovery path loads the newest work
and offers a checkpoint, so an older snapshot is unnecessary.

Option 2 matches the monotonic editing-session model: auto-save includes the
work carried forward from the manual checkpoint, a superset in that sense,
not an append-only history of fields. Save-kind timestamps identify work that
has not been explicitly checkpointed. Comparing the stored manual timestamp
with the caller's last-synced timestamp protects a newer manual save observed
when re-reading storage. The accepted trade-off is no rollback copy and no
atomic compare-and-swap across tabs; localStorage remains read/modify/write.

Option 3 is simpler but would silently replace another tab's newer manual
checkpoint with stale content.

#### IMPLICATIONS

Manual saves clear the auto marker and cancel pending auto-save. Auto-saves
preserve the manual timestamp and use current in-memory content. A newer
stored manual timestamp rejects a stale auto-save with reload guidance.
Recovery restores the single stored copy; Dismiss only clears its marker.
Storage failures retain in-memory work and surface through a toast without
automatic retries. Old entries remain valid without either new timestamp.
