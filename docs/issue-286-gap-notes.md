# Issue #286 — join diagnostics verification and bounded-reader gaps

The bounded-reader follow-up is documented in [issue #288](issue-288-gap-notes.md).
The unsupported cases below describe the original #286 checkpoint.

## Stopped sub-items: inputs without a bounded reader

Diagnostics deliberately return `UNSUPPORTED_PREP_STEP` for these inputs;
ordinary preview is unchanged. No counts are inferred from joined previews.

- **Local nested BLAZE/STORED prepared inputs:** `PrepRoutes.resolve()` reads
  the cached table or calls `StoredTableFiles.read()` before execution. The
  latter validates and reads the complete artifact. Diagnostics bypass that
  resolver and reject cached dependencies before payload I/O. Recomputing the
  recipe would silently substitute current source rows for its cached snapshot.
- **Local governed input tables:** the existing `inputTableTables` hook supplies
  complete memory tables; there is no bounded staging contract. Diagnostics
  reject these inputs before calling that hook.
- **Hosted file/S3 uploads (including durable artifacts):**
  `HostedSources.payload()` decrypts and JSON-parses the complete legacy payload,
  or invokes the version-4 artifact reader with no row-limit argument.
  `HostedData.raw()` then iterates every row. Limiting the result afterwards
  would violate the source-read contract. Diagnostics reject these connectors
  before opening the payload. A future change needs a bounded artifact reader
  with integrity and revision verification, or a separately persisted sample.
- **Hosted nested BLAZE/STORED inputs:** `HostedPrep.load()` uses `readStored()`
  or `cache.read()`, followed by `wireTable()` over every cached row. These inputs
  are rejected before reading a cache, for the same snapshot-semantics reason.

These are stopped sub-items under the brief's explicit fail-closed rule, not
fallbacks to full scans. Local staged uploads and trusted PostgreSQL tables,
and hosted admitted SQL sources, have bounded readers and are supported.

## Sampling clarification

The 10,000-row bound applies before transformations at each physical leaf and
again at each configured join input. Each leaf reads at most 10,001 rows, with
its probe excluded from transformations. This lets filters, aggregates,
windows, branches, and nested direct recipes run on bounded source samples.
A side is marked truncated when its input exceeds the bound **or any leaf
feeding that side was truncated**, even if filtering leaves zero rows.
Sampling follows source order without a sort or random full-source scan.

## Visual review

Rebuilt the static demo and all embed entries with
`npm run build:demo --workspace @opensight/web`. Refreshed
`docs/images/data-prep.png` and `docs/images/opensight-tour.gif` using the #279
local adaptation of `~/workspace/tools/screenshots/readme-gif.mjs` and its
FFmpeg palette workflow (42 captured frames, 2 fps holds, 10 fps encoding).
The static demo is a local artifact, not a deployed server.

Compared the new screenshot with the prior data-prep capture and
`lookfeel-references/qs-2026/qs-data-prep-new.jpg`. The grouped Steps dock,
dotted left-to-right canvas, left/right column lists, Venn selector and compact
Arial controls remain. The diagnostics panel sits below the join configuration,
above the SQL disclosure, and clearly states that static counts are unavailable.
Existing navigation, chrome, spacing and graph-layout differences remain;
QuickSight visual fidelity is not measured. No new visual defect was identified
for an issue; the no-network constraint also precludes remote issue filing.

Browser checks covered configured/unconfigured joins, keyboard join choices,
unapplied type errors, absence of fabricated counts, and the unavailable static
preview. Desktop (1280px) and mobile (390px) had no document horizontal overflow.
There were no page errors or external HTTP requests. Captures, the adapted
script and `browser.json` are in ignored `.opensight/issue-286-verification/`;
build/browser logs are `/tmp/issue-286-demo-build.log` and
`/tmp/issue-286-browser.log`.

## Focused verification and review

- Item 1 compiler/core plus existing prep/branch regressions: **28 passed /
  0 failed / 0 skipped** (`/tmp/issue-286-item1.log`). Includes executing the
  generated SQL in DuckDB and PGlite, bounds before selective filters, NULL and
  composite keys, one empty side, fan-out multiplication and inherited probes.
- Item 2 local API/executor checks: **16 passed / 0 failed / 0 skipped**
  (`/tmp/issue-286-item2.log`). Includes a 10,030-row source, source ownership,
  named errors, ordinary preview regression and shared-deadline expiration.
- Item 3 initial hosted checks: **6 passed / 0 failed / 0 skipped**
  (`/tmp/issue-286-item3.log`). Hosted/local fan-out parity, bounded SQL intake,
  full-reader tripwires, source rotation, foreign/protected-source denial.
- Item 4 web checks plus existing join/SQL/prep regressions: **49 passed /
  0 failed / 0 skipped** (`/tmp/issue-286-item4.log`). Counts, provenance,
  loading, errors, unavailable states, unapplied drafts and stale-response
  suppression are covered.
- Final hosted route review found that the dedicated operation also needed the
  runtime/serverless allowlists and the read-response publication guard. Added
  both, including tests for final revision denial and result-adapter invocation.
  Focused diagnostics/ingress result: **19 passed / 0 failed / 0 skipped**
  (`/tmp/issue-286-route-finish.log`). The initial root run was interrupted during
  setup and restarted after this correction; its incomplete log is retained as
  `/tmp/issue-286-npm-test-interrupted.log`.

- The next full run detected stale generated edge files after that allowlist
  change. Regeneration initially hit the generator's existing 9,500-byte
  pre-header guard. Removing newlines following explicit semicolons preserves
  JavaScript semantics and retains that guard; the final packaged file is
  **9,515 bytes including its generated-file header**, below the existing
  10,000-byte platform limit. Both checked-in copies were regenerated locally.
  Generated/packaged route and hosted diagnostics checks: **20 passed /
  0 failed / 0 skipped** (`/tmp/issue-286-edge-finish.log`). The failed partial
  root run is retained in `/tmp/issue-286-npm-test-edge-failure.log`; the full
  suite was restarted after the fix. No deployment or AWS operation was used.

No new dependency, bundle format or join type was added. `SOLUTION_DESIGN.md`
was not edited. No push, merge, AWS call or external network access was performed.

## Full root verification

Final root `npm test` exited **0**, with `TZ=UTC`, `TMPDIR=/tmp`,
`DATABASE_URL` unset and `OPENSIGHT_CHROMIUM` set to the installed Playwright
headless shell at
`~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`.
The sandbox override enabled local loopback/browser execution only; no AWS or
external network operation was performed.

Node reporters total **5,658 passed / 0 failed / 37 skipped** (5,695 tests).
The Python SDK passed **32/32**. Combined root totals are **5,690 passed /
0 failed / 37 skipped** (5,727 tests; zero cancelled/todo).

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,484 | 0 | 35 |
| Bundle parser | 211 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| TypeScript headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 865 | 0 | 2 |
| Web | 2,750 | 0 | 0 |
| Root conformance/site | 110 | 0 | 0 |
| **Total including Python** | **5,690** | **0** | **37** |

All 37 skips are live-Postgres checks: 36 require `DATABASE_URL`, and one
requires a live TLS PostgreSQL server. No browser test skipped. Final logs and
exit status are `/tmp/issue-286-npm-test.log` and
`/tmp/issue-286-npm-test.exit`; parsed counts are in
`/tmp/issue-286-test-counts.json`.

## Checkpoints

All commits are on `work/issue-286-join-diagnostics`; nothing is merged or pushed.

| Item | Commit | Change |
| --- | --- | --- |
| 1 | `32984f33b86990800c0abd91c31e22e49a8f50fa` | Compiler sampling contract and shared counts |
| 2 | `9a9f71fab7ea882b5c06b49eb980ec4b7a3afae0` | Local execution/API and shared deadline |
| 3 | `a2b6d4c608bd6f13d5ed25df99812f3baf1e5e25` | Hosted bounded readers and contained counts |
| 4 | `811fd6fbeac4433cf03bd189ff808e84e3acb4ed` | Preview-based diagnostics UI |
| 3 follow-up | `62ea71a1251c2281659a5fd7e55a5a9c78b735b2` | Runtime allowlists and final publication checks |
| 3 follow-up | `021b1d5b76479d082e6aee9fa59dbedf78828afc` | Generated edge routes and size-preserving compaction |

Item 5 is the docs, changelog, visual artifacts and final verification checkpoint
containing this record.
