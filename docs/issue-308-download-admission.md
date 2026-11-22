# Issue #308 — table download admission

Hosted downloads execute their transmission callback inside `HostedData.work`.
The node scheduler continues reserving the complete configured `workingBytes`
and `workerRssBytes` envelopes for each active download through HTTP finish or
disconnect cleanup. Concurrent retained responses therefore participate in the
existing aggregate node admission and tenant running/queue limits. Publication
and authorization checks still run before response headers.

Local prep downloads use the same scheduler with one active download, no queue,
the configured BLAZE `maxBytes` memory envelope and a 30-second deadline. The
contained encoder has a 128 MiB heap and 512 MiB RSS ceiling. Local admission
occurs before reading the stored table. Neither path adds a dependency or makes
an external service call.

## Encoding

Admission precedes cell reads, row copies, worksheet creation and encoding.
`B` below is the existing conservative `BlazeTable.bytes` accounting, `C` is
the number of cells including the header, and `K` is 65,536 bytes.

- CSV reserves `B + 16M + 256H + 4K`, where `M` is the greater of the configured
  cell-character limit and longest header, and `H` is the number of columns.
  A first pass computes exact UTF-8 size using only one escaped cell at a time;
  the second pass streams chunks of at most 64 KiB with backpressure. Both
  passes yield and check cancellation every 256 parts. There is no all-rows
  object array, full CSV string or full CSV buffer. The shared CSV escaping
  function preserves formula protection, quoting, CRLF endings, Unicode,
  numeric header ordering and headers on empty tables.
- XLSX reserves `4B + 512C + 4X + 4K`, with the output capacity
  `X = K + 8B + 128C`. These conservative allowances cover input/wire/IPC
  copies, worksheet objects, XML escaping and ZIP scratch, plus returned buffer
  copies. Inputs whose encoding envelope exceeds the remaining work budget
  fail before wire-row allocation. A contained child builds the worksheet one
  row at a time and encodes it with the existing SheetJS dependency. Its heap,
  RSS, parent-liveness watchdog and deadline independently bound execution.
  This uses the existing Linux/procfs containment requirement and fails closed
  with `WORKER_CONTAINMENT_UNAVAILABLE` when that containment is unavailable.
  Output above `X` is rejected before IPC. Binary results avoid JSON encoding
  and an extra `Buffer.from` copy. SheetJS string cells remain text, including
  a leading `=`.

These are admission allowances, not measurements of JavaScript object sizes.
The worker ceilings independently contain encoder allocation. Large XLSX
downloads can be refused even when the stored input itself fits its table
limit. CSV keeps the stored input in memory while streaming; this change does
not stream Parquet decoding or redesign stored-table reads.

## Response ownership and egress

`TableDownload` contains an async byte stream, exact `byteLength`, content type,
filename and the work scope's abort signal. Callers consume it within the work
callback. HTTP streaming awaits finish/close; cancellation terminates and reaps
the XLSX child before releasing admission. Deadlines also interrupt a stalled
response. No detached response buffer outlives its reserved work.

The enclosing hosted egress reservation is reused. Local egress reserves,
asserts the exact size before headers, and either releases an unadmitted
reservation or settles the bytes actually handed to HTTP writes. Generator
read-ahead does not count as served egress. Formats, attachment headers,
`DOWNLOADS_DISABLED`, `STORED_MODE_REQUIRED`, source and owner permissions
remain unchanged.

## Verification

`packages/api/test/table-download.test.mjs` is included by root `npm test`.
It covers admission before cell reads/copies; CSV compatibility and bounded
chunks; XLSX typed cells; cancellation while sizing, streaming and encoding;
real HTTP disconnects during encoding; two concurrent backpressured responses;
aggregate refusal before another encoder starts; reservation release on finish
and disconnect; and exact egress assertions/settlement. HTTP tests deliberately
cork the server socket to hold drain without depending on OS buffer sizes.
Existing local and hosted table download tests cover authorization and format
contracts; the hosted test also pins ownership of the transmission callback.
