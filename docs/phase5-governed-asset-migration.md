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
