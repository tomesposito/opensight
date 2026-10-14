# Issue #95 dashboards — implementation verification and gap notes

Branch: `work/issue-95-dashboards-impl`, based on `8105045d`.
The [slice document](headless-v1-dashboards.md) records the twelve implemented
operations, storage and access rules, renderer configuration, and deferred work.

## Test verification

The post-D-49-correction root `npm test` exited successfully: **2,720 passed / 0 failed /
18 skipped / 0 cancelled** (2,738 total). All 18 skips are live-Postgres
integration tests because `DATABASE_URL` is unset. All 16 dashboard contract
tests passed in this full run.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 553 | 0 | 16 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 25 | 0 | 0 |
| Interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 505 | 0 | 2 |
| Web | 1,328 | 0 | 0 |
| Root conformance | 57 | 0 | 0 |
| **Total** | **2,720** | **0** | **18** |

The initial complete workspace run found two new test-fixture mistakes:
the maintenance fence correctly returned 503, and the local prepared fixture
used the reserved ID `sales`. The fixture assertions and ID were corrected.
Existing suites passed in that run. Targeted dashboard contracts subsequently
passed, including the corrected local fixtures; the final full run above is
the authoritative count, not a sum of individual attempts.

Further security verification covers data-bearing retry receipts after
revision changes and rejects same-ID prepared-to-legacy binding substitution
through existing hosted embed/report paths. The shared parameter tests compare
DuckDB and prepared evaluation and preserve malformed-input diagnostics.

PDF contract tests use a local private-pipe protocol fixture, so root tests
need no installed browser. A separate real Chromium invocation produced a
`%PDF-` artifact from the frozen report definition and left durable metadata
unchanged. Chromium is operator-installed infrastructure selected through
`OPENSIGHT_PDF_CHROMIUM`; no browser binary or new external dependency ships.

## Static demo and reference comparison

The web static demo and local fixture shim were rebuilt. This is a local
static artifact, not a deployed server. The same offline capture script,
fixed clock, viewports and reference pairings as the analyses slice captured
classic Author, new-look Author, and Home Q.

All three captures are **byte-identical** to the analyses baseline, with
**0 page errors / 0 external requests**. The reference comparisons use the
same aspect ratios, regions, exclusions and tolerance of 16:

| Reference pairing | Differing pixels |
| --- | ---: |
| Classic editor | 41.22% |
| New-look editor | 33.58% |
| Q generative | 44.66% |

These are pixel differences, not fidelity grades. Existing gaps remain in
[the analyses notes](issue-95-analyses-gap-notes.md) and their linked querying
baseline. No new visible gap requires an issue or phase-plan change. README
media is unchanged because this slice changes no visible UI. Captures,
reference configuration and reports stay ignored under
`.opensight/issue-95-dashboards-impl/`; reference pixels are not committed.

After the D-49 correction and reboot, `npm run build:demo --workspace
@opensight/web` passed again. Fresh captures are byte-identical to both the
earlier dashboard captures and the analyses baseline, with zero page errors
or external requests. The same reference comparison produced the percentages
above. This rerun's captures, pairings and reports stay ignored under
`.opensight/issue-95-dashboards-resume/`.

## Contract and scope checks

OpenAPI contains all twelve dashboard operations with unique operation IDs,
resolving internal references, and rate-limit responses. The SDK guard maps
every requested route, including both user/group grant paths. The frozen
contract and slice pages describe what shipped rather than a blocked proposal.

`SOLUTION_DESIGN.md`, `serverless-application.ts`, Lambda composition and
`.github/workflows/*` are unchanged. No AWS calls, external network builds,
merge, push or deployment was performed. The D-54 text discrepancy is
recorded in the slice's instruction-precedence section; no additional
product answer was invented. Serverless adapters, anonymous/delegated access,
job-backed exports, assets and MCP remain explicit follow-ups.

## D-49 correction pass (pre-merge, 2026-10-14)

The implementation brief specified an executable-analysis publish gate, but
the confirmed D-49 decision says "Drafts permitted with diagnostics." A
pre-merge correction pass removed the 422 `DASHBOARD_ANALYSIS_NOT_EXECUTABLE`
gate: drafts now publish with their validation diagnostics attached to the
version record (`errors` on `DashboardVersion`, surfaced as `Errors` in the
201 response and `describe_dashboard`) and only unvalidatable definitions
fail. The contract test was updated to assert the new behavior, the OpenAPI
`DashboardPublished` schema and SDK `PublishAnalysisResult` type now include
`Errors`, and the restart validator requires the stored `errors` shape.
The post-reboot full root `npm test` rerun on `fd709523` passed with the exact
per-suite counts above, including all 16 dashboard contracts. The log and
aggregated counts are ignored under `.opensight/issue-95-dashboards-resume/`
(`npm-test-verified.log` and `root-test-counts.json`).

This run required execution outside the restricted sandbox: its procfs uses
a different PID namespace, so the existing worker-containment check returns
`WORKER_CONTAINMENT_UNAVAILABLE`. The same isolated test passed unchanged
outside that sandbox before the full rerun. No guard was weakened and no
additional test was skipped.

The frozen-contract and slice descriptions now consistently distinguish
published visual diagnostics from hard structure, binding and access errors.
No implementation checkpoint was repeated and no product decision changed.
