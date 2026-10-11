# Phase 5 SR4b5 — execution allowance evidence

Implementation checkpoint: `f0a6932`. Full root `npm test`, offline Linux ARM64:
**2,456 passed / 0 failed / 18 skipped / 0 cancelled**, 2,474 total. All skips
require live PostgreSQL. The focused initial-administration suite with local
PostgreSQL 16.15 passed **12 / 0 / 0**; operator checks passed **8 / 0 / 0**.
They cover authority before SQL, distinct original/current releases, held-work
refusal, atomic rollback, retry receipts, preservation of accepted work and
identities, bounded repeated extensions, stale versions and forbidden changes.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 462 | 0 | 16 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 504 | 0 | 2 |
| Web | 1,210 | 0 | 0 |
| Root conformance | 28 | 0 | 0 |

The unchanged application image completed exact 8 MiB UTF-8 CSV native parsing
and Parquet encoding with a 30-second execution allowance, even at a deliberately
restricted 0.5 CPU. It produced 1,024 rows, accounted for 37,367,322 working bytes
and measured 672,546,816 peak worker RSS bytes. This local check used no network,
an unprivileged identity, a read-only root and the existing 2 GiB allocation.

Administration image:
`sha256:878943f53f36325aa7d982b5064a85d23fd7db274ec3df68d1e0d842e1221885`.
All nine bounded runtime smoke cases passed. Registry scanning completed with
the same reviewed finding/package/version set: 8 high, 6 medium, 1 low. Those
findings remain and are not claimed fixed. No dependency or application image
change is part of this administration slice.

The rebuilt hosted frontend's nine files are byte-identical to SR4b4. The fresh
251-frame demo capture had no page errors or external requests; 131 frames match
exactly. The inspected author frame differs only in saved-time text, 162 pixels
at (150,97)–(172,107). No UI change requires new README media. This static capture
is not deployment acceptance.

The reviewed AWS plan changed only the two execution environment fields and the
administration image. The private command returned `budgets-configured`, epoch
one, budget version three. Request version five was selected through a separate
plan changing only the API alias; the active Free subscription was verified.
Real browser startup, password/TOTP authentication, concurrent catalog reads,
exact-version/checksum 8 MiB S3 upload, ingestion and prepared definition creation
passed. Ingestion took 14,948 ms with 900 MiB peak Lambda memory. The subsequent
query returned `EXECUTION_CANCELLED` after about 2.5 seconds, so this was not the
30-second execution ceiling. A local reproduction showed that the HTTP bridge's
synthetic `IncomingMessage` emits `aborted` at normal body EOF because its
`complete` flag is false. That request-completion defect needs a separate fix.
Public DNS remains unpublished; complete query/isolation acceptance is pending.
