# Issue #70: Data section parity

Left-rail **Data** now lands on a Data page (datasets / topics / data sources) with
creation flows. The data-prep canvas is no longer the landing page; it is reached by
creating a dataset, editing one, or preparing a source.

## What shipped

**Data landing page** (`#/data`) — `DataLanding.tsx`
- Header "Data", tabs **Datasets** / **Topics** / **Data sources** (Topics is an honest
  stub: no topic support exists in any API).
- **Create dataset** split button (primary + dropdown with **Create data source**).
- Search box and owner/type filter dropdown; datasets table **Name | Owner | Last
  Modified** with per-row badges (`BLAZE · Cached`, `RLS enabled`, `Rules dataset`)
  and a per-row overflow menu (View dataset, Edit dataset).
- Empty state first: with zero datasets, a genuine empty state with a Create action —
  never staged rows. Owner shows "Local workspace" locally; modification time is
  marked "Not available" because the dataset API does not supply it.

**Create dataset dialog** — `CreateDatasetDialog.tsx`
- "Choose a data source to create a dataset." Searchable list of raw data sources,
  **Upload file** and **Create data source** buttons; Cancel / Select footer. Selecting
  a source proceeds into data prep. Unavailable sources are shown disabled with their
  error code, never silently hidden.

**Create data source dialog** (same component, source stage)
- Searchable connector tile grid sourced from the live connector registry: **Upload a
  file** (.csv, .tsv, .xlsx, .json), **PostgreSQL**, and **MySQL**. No AWS-only
  connectors are listed (all are filtered by `category !== 'AWS'`).
- MySQL shows explicitly as "Not yet implemented" (its registry implementation is
  `unimplemented`) — requested by the spec, but honestly disabled.
- PostgreSQL never creates connections from the dialog: it lists only
  operator-configured sources supplied by the API (credentials come from operator
  environment variables). Cancel / Next footer; Next leads to the connector's
  config form (file upload validated via `uploadFile`), then into data prep.

**Dataset detail page** (`#/data/datasets/<id>`) — `DatasetDetail.tsx`
- Breadcrumb `Datasets › <name>` and "‹ Datasets" back link.
- Header actions: **Generate analysis** split button, **Edit dataset**, overflow menu
  with **Use in new dataset**, **Duplicate**, **Add to folder** (disabled, honest
  reason), **Delete**.
- Tabs:
  - **Summary** — searchable Columns table (Name / Type / Description) plus cards:
    About (storage badge + bytes), Refresh (last refresh status, rows imported,
    timestamp), Access (RLS/CLS status with "Set up" links), Sources (underlying
    files/tables), Usage (linked analyses/datasets counts).
  - **Refresh** — `DatasetRefresh.tsx`: Refresh now, Add new schedule, Schedules
    table, History table with time-range/status filters, "Email owners when a refresh
    fails" checkbox. Backed by the existing `getDatasetExecution` /
    `setDatasetExecution` / `refreshBlaze` API — one interval schedule per dataset in
    UTC; history runs and email delivery are unavailable from that API and say so.
  - **Permissions** — "Manage dataset permissions" table; grants are unavailable from
    the dataset API, so role dropdowns and revocation are disabled with reasons and
    the actual hosted owner is shown; local mode shows an honest empty-grants note.
  - **Usage** — linked analyses (saved drafts on this device, via read-only peek that
    never rewrites storage) and dependent prepared datasets, each with disabled
    "Revoke access" (honest reason).
- Duplicate: names + validates, saves a separate pipeline with a fresh
  `prepared-<uuid>` ID; protected datasets (RLS/CLS/rules) refuse to duplicate
  (fail closed). Delete: requires confirmation, handles dependency denial errors,
  returns to Datasets on success.
- Missing/unavailable datasets show `PREP_NOT_FOUND` (or the underlying error code)
  and never fall back to another dataset.

## Routing
- Left rail **Data** → `page: 'data'` (`#/data`). Prep canvas is `page: 'data-prep'`
  (`#/data/preparation`), still reachable via Create/Edit dataset; reader-role hosts
  are gated by `SECURITY_BUILD_REQUIRED` on all data pages.
- Detail: `#/data/datasets/<id>`; edit: `#/data/preparation/edit/<id>`; "use in new
  dataset": `#/data/preparation/dataset/<id>`; new-source prep:
  `#/data/preparation/source/<id>`; creation dialog: `#/data/new`.
- `#/data/sources` (`page: 'data-sources'`) now renders the landing page with the
  **Data sources** tab selected, instead of the old standalone connector-gallery
  page — one data hub, with the connector grid living in the Create data source
  dialog. `back-to-top` and `session-gate` tests were updated to assert the landing
  (no API client in demo mode) at that route.

## Persistence format
No new persistence. Datasets and sources continue to come from the existing
prepared-dataset API (`listPrepDatasets`, `listPrepSources`, `savePrep`,
`deletePrep`, `getDatasetExecution`, `setDatasetExecution`, `refreshBlaze`).
Duplication and deletion go through `savePrep`/`deletePrep`; refresh schedules are
the existing Blaze interval on the dataset's execution record.

## Honestly disabled / unavailable (with reasons)
- Topics tab: needs a hosted API with topic support.
- Add to folder: needs hosted API support for assigning prepared datasets to folders.
- Duplicate as rules dataset: no rules datasets yet.
- Refresh history runs and failure emails: not supplied by the prepared-dataset API.
- Permissions changes and usage revocation: needs hosted API support for dataset
  sharing; the dataset API does not expose shared grants.
- Direct-query datasets cannot refresh or schedule (no cache to refresh).

## Tests
- `packages/web/test/data-section.test.mjs` — rail routing, tabs, empty state, search,
  filters, badges, row actions, source tab honesty.
- `packages/web/test/create-dataset-dialog.test.mjs` — source selection, connector
  grid honesty (MySQL disabled, no AWS services), upload flow, PostgreSQL
  discovered-source list, cancel/Escape/back, route round trips.
- `packages/web/test/dataset-detail.test.mjs` — summary/columns/search/metadata, tabs,
  header actions and routes, duplicate/delete, permissions (local + hosted),
  usage (drafts + dependents, fail-closed on corrupt storage), refresh
  (refresh-now/schedules/UTC interval validation/history honesty), route round
  trips and malformed-ID rejection.

Built by Codex (landing, dialogs, and most of the detail page) and finished by Muse
after the run hit its usage limit and a VM reboot marked it interrupted. Muse's
finish: `docs/issue-70-data-section.md`, plus two suite-greening fixes —
(1) `dataset-detail.test.mjs` now restores the file's original `window` from every
mount's after-hook (Node runs `t.after` hooks in registration order, so the old
per-mount restore leaked a `localStorage`-only stub into `waterfall-builder.test.mjs`
under `--test-isolation=none`); (2) `back-to-top`/`session-gate` tests updated for
the `#/data/sources` → landing-tab routing.
