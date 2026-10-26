# Issue #129: explicit no-dataset state

`AuthorDraft.noDataset?: true` distinguishes removal from the legacy absent
`dataset` field. Absence of the new flag keeps the existing sample fallback:
fresh demo drafts use the sample; fresh local drafts start empty until sample
data is loaded or prepared data is chosen. Draft version and storage keys are
unchanged. Validation accepts only `true` or an absent flag, and rejects a
flag combined with an explicit dataset.

The `dataset` reducer action with no dataset removes the binding and sets the
flag. Its complete before/after snapshots participate in the existing undo
history. Removed drafts retain sheets, visuals, parameters and calculations,
including prepared-data references that do not exist in the sample schema.
Those references undergo structural validation without sample membership
checks. JSON draft storage and parsing preserve the flag; dirty comparison,
autosave and `keepCurrent` include it without special cases.

Bundle/resource export is different from draft persistence. `serializeDraft`
and `exportBundle` reject an explicitly removed binding with `NO_DATASET`
instead of silently exporting the sample dataset declaration. Saving a local
draft remains available.

## Workspace behavior

The flag selects the existing empty Data/Visuals panels and analysis canvas
in every mode. Field wells, sample previews, dataset metadata and live visual
queries are unmounted. `datasetFields(undefined)` and `dataFields` retain
their existing sample behavior for normal drafts. The local picker leaves
its current selection blank while still offering available data. Manage data
receives the flag separately from sample availability and displays no dataset
rows after removal.

Prepared selection and explicit sample selection clear the flag. Manage data's
sample choice is normalized to the existing implicit sample representation,
avoiding an invalid prepared dataset with reserved ID `sales`. New analysis,
the dataset picker, and bundle import replace the draft and clear removal.
Imported bundles can render their import diagnostics even in a local session
without the workspace sample loaded.

The Author-to-Application dataset notification follows restored state and
undo/redo as well as direct selection. The app's `sampleLoaded` availability
is deliberately independent of an analysis binding: removing a dataset does
not remove the home-page sample, and loading sample data at Home cannot undo
a saved analysis's removal. The workspace banner retains its existing
Remove sample data behavior. Re-entering or reloading the saved draft respects
the persisted flag.

## Verification

`no-dataset.test.mjs` covers old drafts, removal persistence, prepared-field
and calculation retention, strict flag validation, undo/redo, sample/prepared
selection, import, and export refusal. `no-dataset-ui.test.mjs` renders the full
Application composition and exercises actual Manage data removal/reopening,
all workspace modes, queries, save/re-entry/reload, selection paths, the home
sample/banner flow, import, dirty state and autosave. Both are included by the
existing root web test glob. No dependencies were added.

## Static demo and visual review

Rebuilt `packages/web/dist/opensight-demo.html` with the demo build script:
794 modules, 2,229,940 bytes. Chromium exercised removal, the empty Manage data
dialog, undo/redo, save/reload and explicit sample selection against this
`file://` artifact. It recorded zero page errors and zero HTTP/HTTPS requests;
external requests were blocked throughout.

The [empty author capture](images/author-no-dataset.png) shows no sample fields,
empty Data/Visuals docks and Add data guidance. The
[reopened dialog](images/manage-data-empty.png) shows its honest empty state
with no sample row. Compared both with the local QuickSight reference
`qs-2026/qs-manage-data-dialog.jpg`: Data → Visuals → sheet ordering, the
Dataset/Type/Status table and Cancel/Add data footer remain consistent with
the existing implementation. The existing wider/taller OpenSight modal,
offline notices and different header geometry remain; this change introduces
no new styling. QuickSight visual fidelity remains unmeasured.

Refreshed the README hero with the prescribed `readme-gif.mjs` workflow,
adapting its artifact path, route navigation and button names to the current
app. The documented ffmpeg palette workflow assembles 34 frames at two frames
per second. The tour includes the removed-dataset state and undo. Capture
scripts, PNGs and build/test logs are under `/tmp/opensight-issue-129/` and
`/tmp/issue-129-*.log`. The demo is a local static artifact, not a deployment.
