# Auto-save drafts

Author saves local draft definitions 2 seconds after the last change. Further
edits restart the timer; leaving Author cancels it. The current draft is read
when the timer fires. There is no background retry after a failure: another
edit arms a new attempt, and **Save draft** remains available at any time.

The quiet indicator beside Save draft shows **Unsaved changes**, **Saving…**,
then **Saved · HH:MM** in 24-hour local time. It remains Unsaved changes after
a failure. A never-saved draft has no indicator until its first successful
save. Auto-save successes do not toast; failures toast once per attempt with
storage recovery guidance and the Export JSON fallback.

Each entry holds one draft, an `updatedAt` timestamp, and optional ISO
`manualSavedAt` and `autoSavedAt` timestamps. Manual Save draft sets
`manualSavedAt`, removes `autoSavedAt`, and cancels the pending timer. Auto-save
sets `autoSavedAt`, preserves `manualSavedAt`, and adopts a new UUID for an
analysis that has never been saved. Both successful writes update the hook's
saved snapshot, timestamp and last-synced timestamp, so Copy draft link works
after either kind of save.

Before auto-saving, the store re-reads the collection. If the entry's manual
timestamp is newer than the caller's last-synced timestamp (or the caller has
none), it refuses the write with **This draft was saved in another tab. Reload
to keep editing.** An entry deleted in another tab is never resurrected. This
is a synchronous localStorage read/modify/write safeguard, not a cross-tab
transaction or a general merge protocol. See [ITD D-17](itd/D-17-local-draft-autosave.md).

On opening an entry with an auto-save newer than its manual timestamp, or with
no manual timestamp, that work is already restored and clean. A notice says
**Recovered auto-saved work from HH:MM — it was never manually saved.** Save
draft checkpoints the current content and clears the notice. Dismiss removes
the auto-save marker and hides the notice without discarding the recovered
content. There is no older manual snapshot to roll back to. A later auto-save
can create a new recovery notice on the next load.

Storage stays in the existing version-1 collection:

- Demo: `opensight.author.drafts.v1.demo`.
- Local workspace: `opensight.author.drafts.v1.local`.
- Hosted identity: `opensight.author.drafts.v1.hosted.<encoded namespaceId>.<encoded principalId>`.
- Legacy read fallback: `opensight.author.draft.v1` in demo and
  `local.opensight.author.draft.v1` in local mode; never assigned to hosted users.

Older entries without save-kind timestamps remain readable. Existing limits
and validation still apply: 20 entries, 4 MiB of UTF-16 text, no silent eviction,
and no query-result or uploaded-row persistence. Drafts are local to this
browser and origin; they are not synced or published. Reloading before the
debounce finishes can lose the latest unsaved edit.
