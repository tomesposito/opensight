# Phase 5 SR4b4 — connection ownership evidence

The AWS worker failed with `Runtime.ExitError` after an unhandled PostgreSQL
`57P05` idle-session error. The unchanged application image reproduced the same
process crash locally after preflight and a six-second compute interval. The
corrected image survives that interval; no preflight connection is retained.

Implementation checkpoint: `179e72e`. Full root `npm test`, offline Linux ARM64:
**2,453 passed / 0 failed / 18 skipped / 0 cancelled**, 2,471 total. All skips
require live PostgreSQL. Focused runtime tests with local PostgreSQL 16.15 passed
**27 / 0 / 0**, including preflight disposal, actual backend termination, late
connection errors, socket cleanup, startup and private-runtime behavior.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 460 | 0 | 16 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 504 | 0 | 2 |
| Web | 1,210 | 0 | 0 |
| Root conformance | 27 | 0 | 0 |

A private integration probe also completed exact 8 MiB ingestion and publication
through real, separate PostgreSQL runtime roles using the corrected invocation
pools and selected budgets. Native parse and Parquet encoding were real; object
transport used a checksum/version-verifying test transport. This does not replace
the pending real AWS S3/browser acceptance. Focused operator checks passed
**15 / 0**.

Application image:
`sha256:a2e912b2ddfebcc0a68bf5716e690e981192e3211145325aa0794186f59c8639`.
All nine bounded runtime smoke checks passed. The exact image also passed the
real PostgreSQL preflight idle regression. Registry scanning completed with the
same reviewed finding/package/version set: 8 high, 6 medium, 1 low. These findings
remain present and are not claimed fixed.

The rebuilt hosted frontend's nine files are byte-identical to SR4b3. The fresh
demo capture completed 251 frames with no errors or external requests; 151 frames
matched exactly. The inspected author difference is saved-time text only at
(160,97)–(172,107), 96 changed pixels. No user-visible UI change requires new
README media. The static demo is not a deployment.

The reviewed AWS image replacement remains pending at this checkpoint. DNS
remains unpublished until real application and idle acceptance pass.
