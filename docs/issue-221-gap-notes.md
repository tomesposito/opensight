# Issue #221 — bounded XLSX inflation

The XLSX upload path retains the cheap central-directory size check and then
walks local headers in physical order, matching each against exactly one
directory entry. Names, methods, flags, sizes, CRC32 and compressed-stream
boundaries must agree. Every member is validated before `XLSX.read`, including
members outside the selected worksheet. No dependencies were added.

DEFLATE uses `node:zlib` with `maxOutputLength` set to the smaller of 16 MiB
and the remaining 64 MiB aggregate budget. STORED data is checked directly.
Actual output must equal the declared size. Empty members remain valid at an
exhausted aggregate budget; zlib's positive minimum output limit permits a
one-byte probe, which is rejected if it produces any output. This bounds
validation allocation independently of attacker-controlled size declarations.

Signed and unsigned classic data descriptors are validated against central
sizes and CRC32. Zero local size/CRC placeholders are allowed only when the
descriptor flag is set; nonzero local values must match. ZIP64 sentinels still
fail closed with `UPLOAD_LIMIT_EXCEEDED`. Redundant ZIP64 extra fields are
decoded as bigint and accepted only when their values match the plain fields
and limits. Partial, duplicate, malformed or contradictory extras fail closed.
Extra end-of-directory signatures are rejected so SheetJS cannot select a
different directory from the one validated here.

The upload suite passes **35 / failed 0 / skipped 0**, including the existing
CSV/JSON/XLS/staging coverage. XLSX regressions cover forged sizes, high
expansion, remaining aggregate budget, exact limits, descriptors, ZIP64 extras
and sentinels, corrupt/truncated streams, unsupported methods, encryption,
header offsets, 1,000-member acceptance and ordinary workbook parsing.

The full root `npm test` completed successfully: **4,910 passed / 0 failed /
36 skipped**, 4,946 tests total, including 32 Python SDK tests. All 36 skips
require live PostgreSQL configuration (34 API, 2 query-engine); no tests were
cancelled or marked todo. Query-engine passed 615 tests and web passed 2,544.

The sandbox blocked loopback sockets, so the full run used the permitted
unsandboxed test invocation. A separate default Chromium harness probe failed
at startup with `ECONNRESET`; the successful full run set `OPENSIGHT_CHROMIUM`
to the installed Playwright headless shell as directed by the issue brief.
Interrupted preliminary runs are retained separately and excluded from totals.

## Static demo review

`npm run build:demo --workspace @opensight/web` passed. Dashboard and author
captures at 1280 × 800 are byte-for-byte identical to the #220 captures using
the same Chromium build. No page errors, external HTTP requests or horizontal
overflow were observed. The editor retains the Data → Visuals/field wells →
sheet ordering in the private `qs-author-light-flow.jpg` reference; existing
differences in banners, spacing and the empty canvas remain. No new visual gap
was found. README media remain current because this slice changes no UI.

This is a rebuilt local static demo, not a deployed server; visual fidelity
remains unmeasured. Logs and captures are retained locally under the ignored
`.opensight/issue-221-verification/` directory.
