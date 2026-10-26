# Issue #130: recovery CLI delivery acknowledgements

The recovery CLI now uses `storageRecoverTransport` to validate the seven
queue/Scheduler settings before opening its database and wrap `AwsDispatch`
with acknowledgement-only audit logging. Deletion and dispatch share one
invocation-owned AWS client set. The CLI's `--deployment` value determines
both database scope and Scheduler identity. Dry-run transport rejects either
delivery method and needs neither AWS credentials nor dispatch configuration.
The required settings and operator procedure are in
[D-76](itd/D-76-expired-cleanup-recovery.md); its draft status is unchanged.

## Retry defect demonstrated by the new tests

The first regression run proved an additional failure in `ObjectRecovery`:
after a continuation delivery was rejected, assessment selected the newest
unfinished row, the future continuation. Its collector call failed with
`DISPATCH_EVENT_EARLY` instead of retrying delivery. Recovery now selects the
oldest current-epoch, unexpired unfinished obligation. Its collector retries
the existing continuation, receives the external acknowledgement and closes
the original. This is the narrow library change permitted by the brief's
test-proven-defect exception. `DurableDispatch` and `ObjectCollector` are
unchanged.

Tests exercise both an already-dispatched original and a fresh pending
original. In the latter case the unchanged `flush()` sends both the original
and continuation, so both real acknowledgements belong in the audit. A
rejected continuation adds no acknowledgement for that continuation; any
successful original delivery remains correctly recorded.

## Verification

`packages/api/test/storage-recover-cli.test.mjs` contains 21 tests and is
included by the existing API test glob in root `npm test`. It covers config
validation, audit ordering, transport rejections, SQS body receipts,
Scheduler identity/conflict acknowledgement, SQLite races and retry/settlement,
Postgres racing references, denial-only dry runs, and subprocess CLI behavior.
No dependencies were added and no AWS calls were made.

The focused dispatch/collector/recovery run passed **50 / failed 0 / skipped 1**;
its only skip required `DATABASE_URL`. A separate disposable PostgreSQL 16
instance used a private Unix socket with no TCP listener, ran all 21 new tests
with `TZ=UTC`, and passed **21 / failed 0 / skipped 0**. The instance and its
temporary data were removed afterward. Logs are `/tmp/issue-130-targeted.log`
and `/tmp/issue-130-postgres-test.log`.

## Static demo review

Rebuilt `packages/web/dist/opensight-demo.html` (2,229,940 bytes). Chromium
captured the empty author workspace at 1440×900 with HTTP/HTTPS blocked;
there were zero page errors and zero attempted network requests. Capture and
script: `/tmp/opensight-issue-130/author.png` and
`/tmp/opensight-issue-130/capture.mjs`.

Compared the capture with the local `qs-2026/qs-autograph-empty.jpg` reference.
The Data → Visuals → sheet ordering and menu toolbar remain consistent with
the existing implementation. Existing differences remain: larger control
spacing, the offline-mode notices, a dotted empty sheet, and the visible
Properties dock. This CLI change introduces no UI change or new visual gap;
the README images need no refresh. QuickSight visual fidelity remains
unmeasured. The demo is a local static artifact.
