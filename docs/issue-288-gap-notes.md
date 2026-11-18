# Issue #288 — bounded join-diagnostics readers

Follow-up to [issue #286](issue-286-gap-notes.md). The diagnostics contract is
unchanged: at most 10,000 source rows plus one truncation probe at each physical
input, then at most 10,000 rows per configured join side. Probes never enter
transformations. Truncation propagates from every leaf feeding a side, including
when a filter leaves that side empty. Sampling, staging and counting share one
ten-second budget; errors and cancellation return no partial counts.

## Supported inputs

- **Hosted file/S3 uploads:** ingestion atomically persists an independently
  encrypted bounded sample alongside the encrypted payload. Its authenticated
  provenance binds the source ID, payload secret ID, schema and original row
  count. Diagnostics decrypt only the sample; source authorization, active state
  and metadata revisions are checked before and after reading. Retirement and
  expiry remove both encrypted records. S3 diagnostics use the uploaded snapshot
  and make no new call to the original source bucket.
- **Durable hosted upload artifacts:** Parquet writes persist a bounded sample
  in the file's key/value metadata. The trusted artifact descriptor records its
  exact offset, byte length and SHA-256. Diagnostics verify the full object's
  version, size, content type and checksum with HEAD, then request only the sample
  byte range from that exact version. They verify range framing, sample checksum,
  schema and original row count before accepting rows. Source object/retention
  checks and final revision checks remain in place. There is no full download or
  Parquet decode on this path.
- **Nested local and hosted BLAZE/STORED inputs:** memory caches expose a separate
  bounded copy operation with their existing ready-state/revision checks. Local
  stored tables read only their authenticated sample range under the existing
  generation lease and recheck the metadata pointer before returning. Hosted
  artifact caches use the same range reader as durable uploads, retaining
  manifest verification, dependency provenance and final publication checks.
  Diagnostics never recompute a cached recipe. Source-row changes after refresh
  do not substitute current rows for the stored snapshot.
- **Local governed input tables:** the new optional `inputTableSamples(identity,
  sourceIds, limit)` hook requests only the referenced tables and at most 10,001
  rows each. The built-in implementation projects authorized metadata and row
  prefixes before cloning; neither source discovery nor diagnostics clone the
  complete input-table store. The consumer checks source/schema identity, unique
  coverage and row bounds before staging. Existing `inputTableTables` callers
  retain their ordinary-preview behavior.

The embedded artifact sample uses base64 Node structured serialization to retain
scalar types, source order and negative zero. Strings use the same UTF-8
normalization as Parquet, including replacement of unpaired UTF-16 surrogates. Its schema and full row count are
inside the hashed frame. The optional descriptor extension leaves older Parquet
artifacts readable by the ordinary full reader. Sample bytes count toward the
existing encoded-storage and working-memory limits. No dependency was added.

## Remaining gaps and fail-closed behavior

Older encrypted uploads and Parquet artifacts without a persisted sample still
return `UNSUPPORTED_PREP_STEP` for diagnostics. Explicitly re-upload a source or
refresh/publish a snapshot to create a sample. Diagnostics do not backfill by
reading a complete payload or silently refreshing a recipe. Custom hosted cache
or source-artifact adapters and local governed hooks without the bounded method
also fail closed. Ordinary previews and full reads remain available under their
existing contracts.

Missing, invalidated or unpublished snapshots retain their named errors. Corrupt
sample bytes, version/generation changes, authorization changes and exceeded
bounds or deadlines withhold counts. Protected inputs remain denied. Live AWS,
S3 and PostgreSQL verification was not attempted; all object-service fixtures
are local mocks.

## Focused verification

- Item 1 hosted uploads, durable ingestion/transfer and existing source checks:
  **32 passed / 0 failed / 0 skipped** (`/tmp/issue-288-item1.log`).
- Item 2 local/hosted nested snapshots, durable cache and ordinary prep regressions:
  **31 passed / 0 failed / 0 skipped** (`/tmp/issue-288-item2.log`).
- Item 3 governed staging and existing input-table regressions:
  **35 passed / 0 failed / 0 skipped** (`/tmp/issue-288-item3.log`).
- Item 4 integration checks: **29 API passed / 0 failed / 0 skipped** and
  **13 web passed / 0 failed / 0 skipped** (`/tmp/issue-288-item4-api.log`,
  `/tmp/issue-288-item4-web.log`).

Fixtures include fan-out for each input class; 10,001-row probes; inherited
truncation after filters; full-reader/recomputation tripwires; authenticated
sample corruption; snapshot replacement; source retirement; manifest revocation;
shared-deadline expiration; and old/custom readers failing closed. UI checks
cover file, S3, governed, BLAZE and STORED inputs using the unchanged preview-based
result panel. The only web implementation change lets STORED snapshot columns
participate in schema validation, as BLAZE columns already did.

Scalar review additionally found and corrected an unpaired-surrogate difference
between JavaScript strings and Parquet's UTF-8 binding. The persisted sample now
matches the stored snapshot exactly for those strings; the regression compares
bounded and full reads, including NUL and valid supplementary characters. All
**14 artifact tests passed / 0 failed / 0 skipped**
(`/tmp/issue-288-scalar-tests.log`). The
first root run was stopped before completion for this correction; its partial
log is `/tmp/issue-288-npm-test-interrupted.log`. It is not included in final totals.

## Visual verification

Rebuilt the static demo and embed entries with
`npm run build:demo --workspace @opensight/web` (exit 0). Re-ran the local
adaptation of `~/workspace/tools/screenshots/readme-gif.mjs` and assembled the
README hero with FFmpeg's palette workflow: 39 captures, 2 fps holds and 10 fps
encoding. The freshly captured `docs/images/data-prep.png` is byte-identical to
the prior image (SHA-256 `3e81ee37a8e14430938e0fa6f7d7d3ba3c4b573370e59ad7a62baa4e2ffc4740`).
The refreshed `docs/images/opensight-tour.gif` is included in this checkpoint.

Compared the capture with `lookfeel-references/qs-2026/qs-data-prep-new.jpg`:
the grouped Steps dock, dotted pipeline canvas, column lists and Venn selector
remain unchanged. The diagnostics panel retains its preview-based label and
honest static-demo unavailable notice. The existing navigation/chrome/spacing
and graph-layout gaps remain; QuickSight visual fidelity is not measured. No
new visual issue was identified, and no remote issue was filed.

Desktop (1280px) and mobile (390px) checks found no horizontal document overflow,
page errors or external HTTP requests. Captures, the adapted script and
`browser.json` are in ignored `.opensight/issue-288-verification/`; logs are
`/tmp/issue-288-demo-build.log`, `/tmp/issue-288-browser.log` and
`/tmp/issue-288-gif.log`. This is a local static artifact, not a deployed server.

## Full root verification

Final root `npm test` exited **0**, with `TZ=UTC`, `TMPDIR=/tmp`,
`DATABASE_URL` unset and `OPENSIGHT_CHROMIUM` set to the installed Playwright
headless shell at
`~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`.
The sandbox override enabled local loopback, procfs worker containment and
browser execution; no live AWS or external network operation was performed.

Node reporters total **5,679 passed / 0 failed / 37 skipped** (5,716 tests).
The Python SDK passed **32/32**. Combined root totals are **5,711 passed /
0 failed / 37 skipped** (5,748 tests; zero cancelled/todo).

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,500 | 0 | 35 |
| Bundle parser | 211 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| TypeScript headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 865 | 0 | 2 |
| Web | 2,755 | 0 | 0 |
| Root conformance/site | 110 | 0 | 0 |
| **Total including Python** | **5,711** | **0** | **37** |

All 37 skips are live-Postgres checks: 36 require `DATABASE_URL`, and one
requires a live TLS PostgreSQL server. No browser test skipped. Final logs and
exit status are `/tmp/issue-288-npm-test.log` and
`/tmp/issue-288-npm-test.exit`; parsed counts are in
`/tmp/issue-288-test-counts.json`.

## Checkpoints

All work stays on `work/issue-288-bounded-readers`; no merge or push.

| Item | Commit | Change |
| --- | --- | --- |
| 1 | `1673fd6f` | Authenticated bounded hosted upload samples |
| 2 | `a66b17aa` | Bounded local/hosted cached snapshot reads |
| 3 | `7867a95d` | Governed input-table sample contract |
| 4 | `4e8f07f9` | Integration, revision guards and STORED web schema validation |
| 1 follow-up | `2960a964` | Preserve Parquet UTF-8 scalar normalization in samples |

Item 5 is the docs, changelog, visual-artifact and full-verification checkpoint
containing this record.
`SOLUTION_DESIGN.md` is unchanged. No AWS call, external network request or new
dependency was used.
