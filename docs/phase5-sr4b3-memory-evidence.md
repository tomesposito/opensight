# Phase 5 SR4b3 — initial memory correction evidence

Implementation checkpoint: `91b68e2`. Full root `npm test`, offline in Linux ARM64:
**2,450 passed / 0 failed / 17 skipped / 0 cancelled**, 2,467 total. All skips
require live PostgreSQL. The focused local PostgreSQL 16.15 run passed
**16 / 0 / 0**, including admission refusal, row-lock serialization, atomic
rollback, exact retry, preservation of accepted work and use of the new limits.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 458 | 0 | 15 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 504 | 0 | 2 |
| Web | 1,210 | 0 | 0 |
| Root conformance | 26 | 0 | 0 |

Validation/pilot OpenTofu mock tests passed **12 / 0**; focused operator checks
passed **14 / 0**. No dependency, Lambda allocation, concurrency or public API
contract changed.

The unchanged application image parsed and Parquet-encoded an exact 8 MiB UTF-8
CSV containing 1,024 rows with the selected profile, accounting for 37,367,322
working bytes and measuring 676,597,760 peak child RSS bytes. A separate native
preparation/query probe produced the expected East=512 and West=1,024 totals,
measuring 669,843,456 peak child RSS bytes. Both ran without network, with a
read-only root, unprivileged identity and the existing 2 GiB allocation.

Administration image:
`sha256:842437d839b71e2895b75f2e6ef8df5c889f405f3e24162397c6486f62729c6a`.
All nine runtime smoke cases passed. Registry scanning completed with the exact
same finding/package/version set as the reviewed application image: 8 high,
6 medium, 1 low. These findings remain; the scan is not clean.

The rebuilt hosted frontend's nine files are byte-identical to SR4b2. The rebuilt
demo tour captured 251 frames with zero errors/external requests; 161 frames
matched exactly. The inspected author-frame difference is only saved-time text
at pixels (150,97)–(172,107). No UI change requires README media replacement.
This static capture is not evidence of a deployed application.

The reviewed AWS plan updated only function environment values and the private
administration image. The private command returned `budgets-configured`, epoch
one, budget version two, and request version three was selected. Real browser
8 MiB transfer succeeded again, but ingestion exposed a second fault: a retained
preflight connection hit its five-second idle timeout and crashed the process.
SR4b4 corrects that connection lifetime. The prior synthetic operation was
cancelled through its owner API, preserving cleanup obligations. Complete browser
acceptance and apex DNS remain pending.
