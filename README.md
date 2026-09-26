# OpenSight (working title)

A completely open-source business-intelligence platform with **full QuickSight
capability parity** and **bidirectional asset compatibility**: import QuickSight asset
bundles, render them faithfully, and export them back.

**Start here:** [`SOLUTION_DESIGN.md`](SOLUTION_DESIGN.md) — the living design doc.
Vision, architecture, technical decisions (with options and reasoning), and the phased
plan all live there. It changes as we learn; code follows the doc, not the other way
around.

## Status

Phase 0 — research. The `bundle-parser` spike can parse a (reconstructed) QuickSight
analysis bundle and summarize it. Real bundle exports still needed (see OQ-2 in the
design doc).

## Layout

```
packages/bundle-parser  Import/export QuickSight bundle JSON (spike → library)
packages/api            QuickSight-compatible REST API (Phase 1)
packages/web            React renderer + authoring (Phase 1)
packages/query-engine   Planner + expression compiler on DuckDB (Phase 1)
packages/cli            opensight import/export/validate (Phase 1)
docs/research           Bundle format notes, API surface inventory
docs/adr                Decision records
fixtures                Sample bundles (real exports replace reconstructions)
conformance             Round-trip + fidelity tests (Phase 1+)
```

## Quick start (spike)

```bash
cd packages/bundle-parser
npm install
npm run build
npm run summarize ../../fixtures/sample-sales-dashboard.json
```
