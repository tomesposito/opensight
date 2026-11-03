# Issue #161 — gap notes (v1, shipped 2026-11-03)

What v1 deliberately does not do, recorded so the follow-ons are explicit:

- **Hosted mode.** Input tables ship on the local/organization API server
  only. The hosted server (`createHostedApiServer`) exposes no input-table
  routes in v1. The IDD's hosted half (storage in the tenant's Postgres
  namespace, inheriting tenant isolation/backup/erasure) is a follow-on
  slice; nothing in v1 fakes it.
- **App actions.** Forms, If/Else logic, bulk update actions, and
  notifications on top of input tables (Sigma's Data Apps scope) stay a
  later phase, exactly as the issue phased them.
- **Column schema changes.** A table's columns are fixed at creation in v1.
  Adding, renaming, or retyping a column needs its own migration design
  (existing rows + audit semantics) before it ships.
- **Bound dataset check.** `boundDatasetId` is validated for shape only in
  v1; the API does not verify the dataset exists, because tables and prep
  datasets have different owners in the organization server and a wrong
  cross-store check would refuse legitimate references.
- **Grid surface.** The editing surface is the Data page's Input tables tab.
  Embedding the grid as a visual inside analyses/dashboards (the IDD's
  "in place" surface in its fullest form) is a follow-on; the API and prep
  integration are the v1 contract.
