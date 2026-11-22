# Issue #303 — library executor result bounds

Redshift and MySQL/MariaDB library executors now consume rows incrementally
and enforce hard budgets before converting or retaining them: 100,000 rows,
64 MiB cumulative raw-value bytes, and 16 KiB per cell. Trusted options may
only lower those caps. Invalid options reject before connecting. Every budget
breach closes the dedicated connection and returns a sanitized
`EXECUTION_ERROR`, without partial rows or aggregates.

Redshift uses `pg.Query` array-mode row events and the existing raw-string type
parser. Its streaming deadline is separate from `pg.query_timeout`, whose
callback would cause the driver to accumulate rows despite a row listener.
Setup statements retain individual 10-second timeouts; the streamed query has
its own 10-second deadline. Type validation still runs for empty results.

MySQL uses the installed mysql2 driver's callback-free prepared query
`.stream()` API. This retains binary parameter binding, including quoted
question marks and strings containing quotes, backslashes and Unicode. The
default text query formatter would conflict with the required
`NO_BACKSLASH_ESCAPES` session. Its 10-second executor deadline covers setup,
prepare and streaming and is cleared on teardown. Numeric conversion, variant
sessions, verified TLS and loopback rules remain intact.

The planner change is a comment only: shared post-processing continues to
select complete source rows without a SQL `LIMIT`. Both executor tests verify
the complete 1:3 percentage calculation and reject the same input when a row
budget is exceeded. Existing planner expectations are unchanged.

## Verification

The full root `npm test` reported **8,174 passed / 0 failed / 38 skipped**
across 8,212 tests, including 32 Python SDK tests. There were no cancellations
or todos. All skips require live PostgreSQL: 37 need `DATABASE_URL`, and one
needs a configured live TLS PostgreSQL server.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| @opensight/api | 1,529 | 0 | 36 |
| @opensight/bundle-parser | 213 | 0 | 0 |
| @opensight/cli | 73 | 0 | 0 |
| @opensight/embedding-sdk | 10 | 0 | 0 |
| @opensight/headless-sdk | 28 | 0 | 0 |
| opensight-headless-sdk-python | 32 | 0 | 0 |
| @opensight/mcp-server | 74 | 0 | 0 |
| @opensight/o-interpreter | 42 | 0 | 0 |
| @opensight/parity | 11 | 0 | 0 |
| @opensight/query-engine | 2,620 | 0 | 2 |
| @opensight/web | 3,423 | 0 | 0 |
| root-conformance | 119 | 0 | 0 |

The command runner reported status 143 despite complete green summaries for
every stage, including the final root conformance stage. No test processes
remained. The final conformance command was then run independently: **119
passed / 0 failed / 0 skipped**, exit **0**. That repeat is not included in
the full-run totals above. The cause of the runner status was not established;
the full invocation is not claimed to have exited 0.

The run used `TZ=UTC`, `TMPDIR=/tmp`, and the installed Playwright headless shell
through `OPENSIGHT_CHROMIUM`. The complete output, parsed per-suite counts and
independent conformance result are retained under
`.opensight/issue-303-verification/`.

The focused executor/Redshift SQL run passed **98 / failed 0 / skipped 0**.
Real loopback protocol harnesses cover row, cell and cumulative-byte breaches,
exact-limit success, lower-only validation before sockets, teardown, error
sanitization, session statements, and raw-value conversion. Holding the result
open after sending rows proves that budget failure does not wait for query
completion. Driver state assertions verify that no second row array is built.
The MySQL harness covers preparation and binary result packets; it does not
claim live-server SQL equivalence. The initial restricted-shell Redshift run
could not listen on loopback (`EPERM`); the permitted local-socket run passed.

## Static demo comparison

`node packages/web/scripts/build-demo.mjs` rebuilt the static demo from source.
At 1280×800, dashboard, connector gallery and Redshift setup captures each have
**zero changed pixels** against the saved pre-change demo. The gallery also
matches `docs/images/data-sources.png` exactly. The older Redshift setup
reference differs by 2,648 pixels, entirely along the modal's top and side
edges; the pre-change and rebuilt captures are identical. No page errors,
external requests or horizontal overflow were observed, and no new UI gap was
found. No UI media refresh is needed for this executor-only change.

Build output, captures and comparisons are retained in the ignored
`.opensight/issue-303-verification/` directory. The demo is a local static
artifact, not a deployed API; visual fidelity is not measured.

## Scope

No dependencies, package manifests, lockfiles or `SOLUTION_DESIGN.md` changed.
No AWS calls, external database connections, merge or publication were made.
Live Redshift/MySQL/MariaDB semantics and server-side cancellation completion
remain outside the loopback harness evidence. Raw-value budgets do not measure
total JavaScript heap usage, driver packet allocation or server memory.
