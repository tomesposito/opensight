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
