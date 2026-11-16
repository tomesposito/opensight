# Issue #270 — MySQL and MariaDB hosted sources

MySQL/MariaDB now use the hosted source path with declared table/schema
bindings, operator endpoints, encrypted tenant credentials and current
RLS/CLS admission. See [connector configuration and limits](connector-mysql.md).
No AWS calls, live database verification, deployment or publication occurred.

## Adjustments to the run brief

- MariaDB session settings alone were insufficient for the library executor:
  generated SQL also contained `utf8mb4_0900_bin`. A token-aware conversion
  changes generated collation clauses and preserves quoted identifiers/literals.
- Text-protocol `query` binding uses mysql2's `queryFormat` hook with UTF-8 hex
  literals. Its default backslash escaping is incompatible with the required
  `NO_BACKSLASH_ESCAPES` session; hostile quote/backslash/Unicode values are tested.
- The injectable MySQL streamer is appended to the `HostedData` constructor,
  preserving all existing positional PostgreSQL/budget/cache/analytics callers.
- `compilePrep` only supports DuckDB/PostgreSQL. Hosted prep already stages
  admitted database rows into DuckDB. Browser MySQL/MariaDB prep validation uses
  that same staging model, retaining `sourceDialect: 'mysql'` and the real
  connector separately from the DuckDB transformation SQL. The local PostgreSQL
  prep path is unchanged; no native MySQL prep compiler is claimed.

The wire harness evaluates a narrow SQL subset with SQLite, exercising the
real mysql2 handshake, authentication and text protocol. This proves wiring,
fixture filtering and bounds, not live server SQL equivalence. Live RDS MySQL /
Aurora MySQL verification remains Tom's follow-on.

## Static demo review

The single-file demo was rebuilt. Before/after dashboard captures at 1280 × 800
have zero changed pixels. The connector dialog now includes enabled MySQL and
MariaDB choices; setup still states that an operator-provisioned hosted source
is required, and Select remains disabled without one. Captures have no page
errors, external HTTP requests or horizontal overflow. Setup's longer
environment-name form scrolls within the existing dialog.

Comparison with `qs-2026/qs-data-create-dataset.jpg` retains the existing
centered dialog, source search, upload/create-source actions and footer
selection flow. The existing empty-state illustration, spacing and wider
catalog differences remain; no new layout gap was found in this slice.
QuickSight visual fidelity remains unmeasured. The README tour GIF and source
screenshots were refreshed against the new local static demo.

Capture scripts and results are in the ignored
`.opensight/issue-270-verification/` directory. The tour script was copied from
`~/workspace/tools/screenshots/readme-gif.mjs` with current local paths and
navigation. Standard installed headless Chromium was used because the legacy
`/opt/meta-chromium/chrome` executable requires an unavailable startup policy.
This is a local static demo, not a deployed server.

## Verification

Focused checks: 110 MySQL/protocol/registry/source-plan tests, 48 API/analytics
checks, 9 source lifecycle/migration checks, 8 legacy connector/source checks,
and 79 web connector/prep checks passed with zero failures or skips.
Full root-suite results will be recorded after the final run.
