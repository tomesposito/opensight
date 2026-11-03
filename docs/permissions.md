# Permissions and row-level security

Access to an OpenSight analysis or dashboard and access to its data are separate
permissions. Sharing a definition lets someone open that asset; it does not give
them the owner's credentials, prepared data, or row and column permissions.

## Identity and namespaces

An authenticated installation verifies credentials on the server and resolves the
user and their current group membership from its registry. Users, groups, assets
and dataset policies belong to a namespace. A request cannot choose a different
identity or namespace through a query body or an identity header. Explicit
namespace paths must match the verified namespace; a mismatch returns 404.

Unresolved identities and invalid policies are denied. Administrators can manage
resources in their namespace, but **there is no administrator bypass of dataset
policies**. Source restrictions remain an independent check.

## Sharing analyses, dashboards and folders

Asset shares name a user or group in the same namespace and use two roles:

- **Viewer** permits reading the definition, subject to the folder's permissions.
- **Co-owner** permits management where the user's workspace role also allows it.
  A co-owner grant cannot promote a reader into an author or administrator.

Folder permissions and asset permissions must both allow access. An asset share
cannot bypass its containing folder. User and group shares are additive:
removing a user's direct share does not remove access granted by a group they
still belong to. Moving or copying an asset does not change dataset security.

The versioned asset permission API described by
[D-58](idd/D-58-asset-permission-verbs.md) requires build capability and co-owner
access to read, grant or revoke shares. Viewers cannot enumerate grants.
Clearing the last share through these versioned asset verbs restores inherited
access; it is not a way to make an asset private.

The older, unversioned [folder and sharing APIs](folders-sharing-embedding.md)
have different management and clearing rules: share administration requires an
administrator, and revoking the last explicit asset share leaves it private to
administrators. For those folder APIs, `grants: null` restores namespace
inheritance and `grants: []` restricts the folder to administrators. Check which
API your integration uses before changing grants.

Neither a viewer nor a co-owner share grants independent dataset access. Queries
of stored visuals run with the authenticated viewer's data permissions.

## Row-level security

Row rules grant users or groups access to matching rows. For example, a rule can
limit a sales team to rows whose region is East. Matching user and group rules
combine as a union: a person with East and West grants can see both regions,
without duplicate rows. Dashboard and application filters can narrow that set;
they cannot widen it.

Administrators configure rules against physical columns. Rules run before
calculations, filters and aggregation, so totals are computed from authorized
rows. They are validated predicates, not arbitrary SQL.

Creating the first row rule protects the dataset. Removing the last rule leaves
protection enabled: a protected dataset with no matching rule returns
`ROW_ACCESS_DENIED` before reading data. Unknown users or groups referenced by a
policy invalidate it, even if that rule would not match the caller. Imported
security metadata that the system cannot enforce also fails closed.

## Column-level security

An unprotected column remains available. Once a column is protected, a user
needs at least one matching allow grant and no matching deny grant. A deny from
either the user or any group wins. Deleting the last grant leaves the column
protected, with nobody allowed by that grant set.

Queries cannot use denied columns indirectly through calculations, filters,
sorting or grouping. The query planner reports a requested denied column as
`UNRESOLVED_BINDING` with `unknown column: <name>`, just like a missing column.
Some direct source and embedded checks use `COLUMN_ACCESS_DENIED`. A query does
not silently drop a requested field or return data from a denied column. A row
policy may use a hidden column internally without exposing it to the viewer.

## Published dashboards built from prepared datasets

Hosted readers can query or export a published prepared dashboard through the
[share-the-recipe path](issue-155-reader-prepared-access.md) only when they are
independently authorized for **every source input** of the publisher's saved
recipe. A dashboard share alone does not provide that authorization. Source IDs
resolve under the reader's tenant, namespace and user; there is no source-sharing
or credential-delegation API added by this path.

The published version selects the recipe, including nested dataset recipes.
Every input is checked, including joins, append steps and unused branches.
Reader row policies filter source rows before preparation. Denied columns are
removed from the recipe's available schema; a recipe that requires one fails.
Missing access, cycles and invalid or unsupported recipes return
`DASHBOARD_DATASET_ACCESS_DENIED` (403), without partial results.

The recipe runs fresh in bounded request-local memory, including its joins and
aggregates. It does not read or write the publisher's prepared caches or expose
their uploaded payloads. Revoking source access blocks fresh reads and replayed
query/export requests. Policy changes also require a fresh authenticated session.

This is not general prepared-dataset sharing. Owner preparation and cache
behavior are unchanged. Local prepared dashboards retain their owner check;
background rendering and embedded content retain their existing owner and
single-source limits. The hosted reader recipe path does not remove those
limits or grant access to another owner's prepared artifacts.

## Local development and the static demo

Without configured security, explicitly unrestricted local fixtures retain
their development behavior. Security resource routes return
`SECURITY_NOT_CONFIGURED`; they do not pretend to enforce policies. The library
provides no default credential.

The static demo uses public bundled samples. Its security controls say
**Needs hosted API** and are disabled. It does not provide a simulated login,
tenant switch or browser-only enforcement of dataset security.

See [security and namespaces](security-namespaces.md) for configuration, policy
formats and named errors, and [folders, sharing and embedding](folders-sharing-embedding.md)
for the older API's resource contracts. Those guides, the shipped
[reader recipe behavior](issue-155-reader-prepared-access.md) and
[D-58's permission verbs](idd/D-58-asset-permission-verbs.md) are the sources for
this page.
