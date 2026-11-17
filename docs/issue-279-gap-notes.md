# Issue #279 — prep join suggestions and step SQL

Built on `work/issue-279-prep-join-sql` under the supplied run brief.

## Item 3 — blocked by the preview architecture

The brief requires bounded preview diagnostics that never cause full source
scans, and explicitly instructs stopping an item that the existing compiler and
preview architecture cannot support safely. Item 3 is stopped under that rule.
No diagnostics query, endpoint, fabricated counts, or fan-out indicator was added.
The diagnostics fixture/fan-out tests requested in item 5 therefore cannot ship.

Evidence from the existing paths:

- `packages/query-engine/src/prep.ts`: `compilePrep` appends `LIMIT limit + 1`
  only to the final projection. Source relations, aggregates, windows, joins and
  their upstream CTEs are not input samples. A bounded output is not a bounded
  source read.
- `packages/query-engine/src/prep-executor.ts`: the DuckDB interrupt timer and
  PostgreSQL statement timeout cap execution at ten seconds, but execute that
  same final-output-limited query. They do not prevent full scans.
- `packages/api/src/hosted-prep.ts`: `preview` calls `load` before slicing
  `table.rows(limit)`. `load` obtains complete admitted leaf tables via
  `HostedData.table` and invokes the contained prep worker. Its limit of 1–500
  does not bound leaf reads or either join input.
- `packages/api/src/hosted-data.ts`: both `table` and the source `preview` path
  materialize the admitted source before returning a row slice. Reusing source
  previews would have the same problem. Tenant resource budgets reject excess
  work; they are not the requested preview sample limit.

Counts cannot be recovered from the joined preview alone: an inner join omits
unmatched inputs, and a capped result cannot establish duplicate multiplicities
on either side. Supporting the requested diagnostics needs an input-sampling
contract across compiler, source admission/staging, and both execution paths,
with one ten-second budget and explicit sample provenance. That contract is
absent today. The existing preview behavior is unchanged; no parallel compiler
or additional full-scan path was introduced.
