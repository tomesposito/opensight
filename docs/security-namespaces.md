# Row and column security and namespaces

Phase 3b adds OpenSight-local policy resources. These are not an implementation of
AWS permission-dataset or tag-policy formats. Imported unknown security metadata
and source restrictions still fail closed.

## Trust boundary

`createApiServer({ dataRoot, security: { authenticate, initialState, storePath } })`
accepts a server-owned credential verifier and a registry of users and groups.
The verifier returns only `{ namespaceId, userId }`; the server resolves membership
from its registry on every request. Administrators configure the verifier; query
bodies, identity headers and imported assets cannot assert users or groups.
`emptySecurityState()` creates the default namespace. Provision an initial admin
in `initialState.users` before starting the server. Credentials do not belong in
this repository or the policy store. Use an authenticated transport in a hosted
installation. The library never supplies a default credential.

Without `security`, existing explicitly unrestricted local fixtures retain their
local development behavior. Security resource routes return
`SECURITY_NOT_CONFIGURED`. They never pretend to enforce policies in that mode.
With `security`, every request needs a verified, registered principal. There is
no administrator bypass of dataset policies. Metadata/source restrictions remain
independent gates. Direct engine callers own the trusted `PlanRequest.security`
context and must never populate it from untrusted input.

## Row policies

Namespace administrators manage `GET /api/datasets/sales/row-rules` and
`GET|PUT|DELETE /api/datasets/sales/row-rules/{id}`. PUT bodies contain `principals`
and `predicate`; the URL supplies the ID. Example (synthetic identities):

```json
{
  "principals": [{ "type": "group", "id": "east-team" }],
  "predicate": { "column": "region", "operator": "eq", "value": "East" }
}
```

Principals within a rule are ORed. All matching user and group rules are ORed.
Overlapping rules grant the union of rows and never duplicate rows. `all` and
`any` combine nonempty predicate lists with AND and OR respectively. Application
filters further restrict that union with AND; they cannot widen it. Supported
physical-column comparisons are `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`
(`values`), `is-null` and `is-not-null`. Other comparisons use `value`.
Values must match the column's type, with ISO dates/UTC datetimes for date columns.
SQL NULL follows SQL three-valued logic; only TRUE grants a row.

Rules are validated, bounded, quoted and parameterized, never SQL fragments.
Both dialects apply RLS in the source SQL relation before row calculations,
PRE_FILTER, visual filters, aggregates and table calculations. Protected plans
cannot be evaluated over arbitrary rows by the browser evaluator.

Creating the first rule enables row protection. Removing the last rule does not
remove protection: no matching rule returns `ROW_ACCESS_DENIED` before data access.
Missing and unresolved principals produce `PRINCIPAL_REQUIRED` and
`UNKNOWN_PRINCIPAL`. Unknown rule principals invalidate the policy, even in a rule
that would not match. Namespace or dataset binding mismatches fail closed.

The atomic JSON policy store uses the existing single-process persistence mechanism
and validates persisted resources before startup. Background reports, alerts and
refresh do not have authenticated execution identities in this slice; in secured
mode their query work fails closed instead of using an administrator identity or
materializing unrestricted protected data.

## Column policies

Administrators manage `GET /api/datasets/sales/column-grants` and
`GET|PUT|DELETE /api/datasets/sales/column-grants/{id}`. A PUT body contains
`column` (exact physical name), `effect` (`allow` or `deny`), and `principals`
(the same user/group selectors as row rules).

A column becomes protected when its first grant is created. It then requires at
least one matching allow and no matching deny. Deny takes precedence regardless
of whether it comes from a user or group. Unmentioned columns remain available.
Deleting the last grant leaves the column protected with no allowed principals.
The persisted `protectedColumns` list is independent of the grants themselves.

The binder rejects requested denied columns with `COLUMN_ACCESS_DENIED`, including
indirect calculation dependencies, dimensions, filters, parameter filters,
partition fields and sort fields. It never silently drops a requested field.
Multirow SQL results project only permitted physical columns. RLS predicates may
use a denied column internally without granting that column to the caller.

## Namespaces

All identities, group membership and dataset policies include a namespace ID.
The verifier chooses it from verified credentials. Requests cannot select a
namespace through query parameters or identity headers. Optional explicit paths
`/api/namespaces/{namespaceId}/assets`, `/analyses/{id}/definition` (after that
prefix), `/datasets/sales/query`, `/users`, and `/groups` must match the verified
namespace; a mismatch is a 404. Existing paths use the verified namespace.

`GET /api/assets`, `/analyses`, `/dashboards`, and `/api/datasets` list only the
current namespace's resources. `namespaceDataRoots` maps registered namespace IDs
to trusted startup directories. The existing `dataRoot` belongs to `default`.
Each directory loads an independent definition snapshot and sales query binding;
identical asset IDs can exist in different namespaces. A namespace without a root
has no assets and never falls back to default. Roots must use the current sales
schema, as the existing query API still supports only that binding.

`GET /api/namespaces` lists the caller's namespace. `GET|PUT|DELETE
/api/namespaces/{id}` reads/renames/deletes it. An administrator may create an
unused ID with PUT `{ "name": "Tenant" }`; this copies that administrator's
registered user into the new namespace. It does not issue credentials or grant
cross-namespace access. Provision credentials through the trusted verifier.
An existing other namespace remains invisible. Deletion requires no assets,
policies or groups and no other users, and deletes the sole administrator with the
namespace. The default namespace cannot be deleted.

Namespace administrators manage `GET /api/users` and `/api/groups`, and
`GET|PUT|DELETE /api/users/{id}` and `/api/groups/{id}`. User PUT bodies contain
`name` and `role` (`admin` or `reader`); group bodies contain `name` and `userIds`.
IDs may repeat across namespaces. Unknown/duplicate group members, foreign
namespace fields, unresolved policy principals, referenced user/group deletion,
and deletion/demotion of the last administrator are rejected atomically.

Legacy automation resources belong to default and require its administrator in
secured mode; other namespaces cannot inspect their configuration or history.

## Fail-closed diagnostics and verification

The HTTP boundary returns `PRINCIPAL_REQUIRED` for missing credentials,
`UNKNOWN_PRINCIPAL` for failed verification or absent registry entries, and
`FORGED_PRINCIPAL` for caller-supplied identity/policy body fields or identity
headers. Query credentials use the injected verifier, never a principal selected
in a query body. Unconfigured credential verification cannot accept an
Authorization header. Readers cannot modify policy resources; administrators
cannot bypass row or column rules. All responses remain `Cache-Control: no-store`.

Tests execute RLS SQL against local DuckDB and embedded PostgreSQL (PGlite), inspect
the Postgres executor's driver call, and verify both executors reject unauthorized
work before opening a data file/connection. API tests use loopback HTTP, a synthetic
credential verifier and a stub mail transport. No AWS calls, remote database
connections or additional dependencies are required. Root `npm test` already
includes workspace test globs and the public strict TypeScript consumers.

## Static demo

The Security & namespaces mode explains RLS, CLS and namespace configuration,
labels each control `Needs hosted API`, and disables configuration actions.
It explicitly identifies the bundled samples as public and provides no simulated
login, tenant switch, local policy save or client-side security enforcement.
