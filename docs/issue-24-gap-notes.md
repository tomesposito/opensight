# H4 (#24): verification and visual review

Work stays on `work/issue-24-h4-budgets-containment`, based on `4232a5f9`.
The design documents, dependency lockfile and frontend source are unchanged.
No dependencies, external network calls, deployment, merge, push or issue closure
are part of this slice. Mechanism, frozen migration, measured ceilings and open
HQ-8 decisions are documented in [h4-budgets-containment.md](h4-budgets-containment.md).

## Acceptance evidence

Tests flood one tenant while another executes, attempt H3 ownership/policy/context
bypasses under contention, assert exact queue/source accounting, and measure
latency, event-loop delay, parent RSS growth and independently sampled worker RSS.
Other checks enforce row/result/cache/worker-memory limits, preserve another
tenant's cached results, cancel every reachable execution family, and prove that
a blocked evaluator dies on deadline or parent death. Live PostgreSQL checks
observe cancellation of an active cursor and closure of both connections. An
HTTP disconnect cancels its active cursor without sending response bytes.

Fake timers exercise queue expiry and cancellation. Restart tests reload identical
budget configuration, reject old context objects and do not replay queued work.
An injected migration failure rolls back the configuration transaction. Graceful
shutdown retains admission and the CLI maintenance lock through cleanup.

The first full run found an existing cursor mock that did not recognize the new
backend-PID lookup. The mock now exercises the lookup and still verifies bounded
batches, read-only UTC execution and consumer refusal. The final verification uses
a detached runner and an explicit exit file; the earlier long tool session ended
with exit 143 and is not counted as a successful run.

## Static demo comparison

`TZ=UTC npm run build:demo --workspace=@opensight/web` rebuilt the static demo.
Chromium captured dashboard, author and data preparation at 1440×1000 with external
HTTP blocked. Captures recorded zero page errors, zero external requests and no
page-wide horizontal overflow. Evidence is under `/tmp/h4-browser/` and
`/tmp/h4-browser.log`; the build log is `/tmp/h4-demo-build.log`.

Visual comparison with `docs/images/author.png` and `qs-author-light-flow.jpg`
confirms the existing Data → Visuals → sheet flow, docked properties and honest
static-demo notices. The author raster is not pixel-identical to the README
reference; visual review shows the same layout and text. No new user-visible gap
was found. The empty builder is not a visual-fidelity measurement against the
populated QuickSight analysis. No frontend changed, so existing README images and
the hero GIF remain current. This is a local static demo, not a deployed server.

## Full verification

The final root `npm test` exited **0** with **1,463 passed / 0 failed /
0 skipped**, using `TZ=UTC` and `DATABASE_URL` for a disposable local PostgreSQL
instance. All live PostgreSQL tests ran. Strict TypeScript and package type checks
ran in the workspace test commands. The API count includes fifteen new H4 tests.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 239 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 511 | 0 | 0 |
| Web | 477 | 0 | 0 |
| Root conformance | 3 | 0 | 0 |
| **Total** | **1,463** | **0** | **0** |

The completed run verifies implementation checkpoint `b673e9df`. Evidence is
`/tmp/h4-verified-tests.log` and `/tmp/h4-verified-tests.exit`. `git diff --check`
passes. Implementation and documentation are checkpointed on the requested
branch; no publication, merge or issue closure was performed.
