# Issue #82 — SR1 verification and visual comparison

This is a code-only runtime change. No AWS credentials, AWS API calls,
provisioning, deployment, spending, push or merge was performed.
`SOLUTION_DESIGN.md` is unchanged. Runtime configuration and phase boundaries are
documented in [phase5-sr1-runtime.md](phase5-sr1-runtime.md).

Full root `npm test` completed on 2026-10-10 with exit **0**:
**2,224 passed / 0 failed / 12 skipped / 0 cancelled** (2,236 total).
Every skip is an existing live-Postgres integration test (`DATABASE_URL` unset).
Strict TypeScript builds and the root conformance tests passed.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 335 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 502 | 0 | 2 |
| Web | 1,129 | 0 | 0 |
| Root conformance | 7 | 0 | 0 |

The 29 new runtime tests pass locally with zero failures or skips. They exercise
HTTP/Lambda composition, trusted ingress, startup deadlines, scheduler/migration
invocations, SQL fault injection and resource teardown. The real Linux native
worker checks confirm that worker PIDs, including their watchdog threads, no
longer exist before success/error/cancellation returns. A real loopback TCP
server confirms teardown of a stalled PostgreSQL handshake. Failure-to-clean
tests run in isolated child processes and verify runtime quarantine.

The initial full-suite attempt overlapped the demo build and exceeded an existing
H4 execution-time threshold (3,594.5ms versus the 3,000ms limit). That threshold
was not changed. The final full-suite acceptance run ran without
concurrent builds or browser capture and passed that check (1,445.4ms maximum
execution). Fake-time startup tests wait for explicit
connection/query checkpoints before advancing the clock, so asynchronous file
cleanup does not make their timing dependent on machine load.

The static demo was rebuilt using
`npm run build:demo --workspace @opensight/web`. The maintained
`~/workspace/tools/screenshots/capture-issue70.mjs` capture was run from a
temporary copy against the freshly rebuilt `packages/web/dist/opensight-demo.html`,
with output redirected to `/tmp/opensight-issue82-captures/` and external HTTP
requests blocked. There were zero page errors.

| Screenshot | Changed pixels versus committed image | Total pixels |
| --- | ---: | ---: |
| Data landing | 0 | 1,024,000 |
| Data source dialog | 0 | 1,024,000 |
| Data preparation | 0 | 1,024,000 |

Visual inspection against the existing QuickSight Data landing reference confirms
the previous differences: OpenSight's navy shell, simpler navigation, missing
promotional banner, and larger spacing remain. SR1 introduces no visible changes
or new visual gaps. The existing README images/GIF remain applicable; no UI asset
refresh is needed for this backend phase. The static demo remains an offline
preview, and visual fidelity to QuickSight is not claimed as measured.

SR2/SR3 durable admission, artifacts and event execution remain explicit gates;
the default Lambda runtime cannot silently use H8 in-process compute/job safety.
Actual Aurora roles/RLS, CloudFront provenance, WAF behavior, container-image
compatibility and cloud idle/resume measurements remain authorized SR5 work.
