# Phase 5 SR4b2 — runtime row-lock privileges

Live initial acceptance authenticated both HTTP boundaries and the owner, but
upload reservation failed with PostgreSQL permission denied on `sr_control`.
PostgreSQL requires UPDATE privilege on at least one column for SELECT FOR UPDATE.
The runtime must lock control/configuration rows without changing their values.

## Contract

For PostgreSQL only, add `runtime_lock INTEGER NOT NULL DEFAULT 0` with a named
CHECK requiring zero to `sr_control`, `sr_limits`, and `h4_budget_config`.
These columns carry no application data. Grant the validated non-owner runtime
operator UPDATE on only `runtime_lock`, in addition to existing SELECT. Never
grant table-wide UPDATE, INSERT, DELETE, TRUNCATE, schema ownership or DDL on
these three tables. The tenant role receives no lock-column grant. Validate
existing columns/constraints exactly; incompatible objects fail closed. Keep
existing schema markers, business columns, epoch, admission and budgets intact.
This additive PostgreSQL privilege support is part of composed migration and
its transaction. SQLite keeps its existing transaction serialization.

Add a strict IAM-only `repair-initial-locks` administration command, additionally
requiring the current operator credential, version one, original bootstrap
operation ID, expected epoch one and the exact activated application digest.
Under the owner control-row lock, require the exact owned schemas and markers,
current key/configuration, two unchanged initial testers, matching bootstrap and
activation HMAC receipts, and open initial admission. Before its first execution,
require every durable work table empty; authentication sessions and usage records
from initial acceptance may exist. Install only the above lock support and
validated runtime grants, recording an audit and command receipt atomically.
Exact retries verify installed lock support and return the receipt; changed
arguments, changed testers, later epochs, foreign schema, closed admission, or
accepted durable work before first repair fail closed. It is neither arbitrary
SQL nor a general maintenance/release operation. Do not rerun initial bootstrap
or activation and do not reset credentials.

The existing private administration Lambda may select a separately tested,
immutable image from the same deployment repository through an optional
`administration_image_uri` input; all other functions retain the activated
application image. Its environment release digest continues to identify the
application being administered. The private operator reads the administration
artifact from an external release file, preserves current consumers/configuration,
and checks both artifact and application identities before invoking repair.
Saved plans may change only the intended administration image for this step;
all existing account, source, state, cost and no-deletion safeguards apply.
No new function, network service, secret, public endpoint or idle timer is added.

## Verification and deployment

Reproduce missing row-lock permission using real PostgreSQL with the exact
non-owner runtime role. Prove all three locks succeed after repair, conflicting
transactions serialize, and runtime attempts to change state/epoch, limits,
budget body or the lock sentinel fail. Verify tenant denial, role validation,
transaction rollback, original activation binding, accepted-work refusal and
exact retries. Run the full root suite and existing infrastructure checks,
rebuild/capture the unchanged demo, build/smoke/scan the administration artifact,
and review its saved AWS plan. Invoke the bound repair, then repeat real browser
upload, ingestion, query, isolation and idle acceptance before publishing DNS.

Source: [PostgreSQL SELECT privileges](https://www.postgresql.org/docs/16/sql-select.html).
