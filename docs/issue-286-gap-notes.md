# Issue #286 — join diagnostics verification and bounded-reader gaps

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
