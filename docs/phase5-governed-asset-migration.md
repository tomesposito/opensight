# Phase 5: governed asset migration

The frozen serverless owner migration applies the metadata kind upgrade for
governed metrics (#157) and preparation templates (#160). Existing PostgreSQL
databases previously retained their old resource constraints even after the
runtime and viewer routes were upgraded.

The owner path now shares `ensureMetricKind` with metadata initialization.
PostgreSQL updates the existing kind and owner checks; SQLite rebuilds the
resource table and restores its links inside the surrounding transaction.
Existing rows remain intact, governed assets require an empty owner, and
unknown resource kinds remain rejected. Repeated migration is idempotent.
Runtime roles retain their existing permissions and receive no DDL access.

For the already-current registered inventory, D-87 permits the temporary owner
controller to preserve the epoch when the only outstanding work is the exact
inventoried set of future, dispatched, unclaimed object-cleanup events. The
controller binds their checksum and the independent epoch checksum into its
plan, drains every runtime invocation, registers the pinned backup, and verifies
unchanged cleanup rows through migration and reopen. It preserves registry
history while advancing its revision. It does not change schedules, retention,
objects, cleanup attempts or runtime permissions.

The private PostgreSQL/control rehearsal passes 11 tests, including same-epoch
freeze/migration/reopen, acceptance of the retained envelope after reopen,
denial of changed or unsafe pending work, preservation rollback, and registry
history. The application bytes remain the tested attested build; these operator
changes and their confidential configuration are not bundled into that runtime.

Deploy through the registered backup and maintenance protocol with the matching
runtime and viewer function. A compatible-release approval cannot substitute
for this migration. Tests exercise legacy constraints, preserved data, invalid
owners and kinds, PostgreSQL runtime privileges, and rollback when a later
migration checkpoint fails.

Visual gap notes: the rebuilt static demo was captured in the in-app browser
and compared with `docs/images/sample-dashboard.png`. The five-chart layout,
East revenue 500, discounted revenue 450 and total 500 remain intact. The logo
and palette differences belong to the existing #166/#167 changes. This migration
changes no UI files, and the comparison found no additional visual gap. The
capture is a static demo, not evidence of a deployed API or measured parity.
