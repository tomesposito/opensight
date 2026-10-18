# Issue #114: verification and boundaries

The partial implementation was reviewed and retained where it matched the brief.
Completion accounting now uses H8's durable counters/events and H1 tenant locking;
provider totals, marked estimates, cap denials, audit warnings, metrics and both
existing HTTP completion callers are covered. See [the operator guide](ai-spend-caps.md)
and [D-82](itd/D-82-ai-spend-caps.md).

## Scope corrections from repository evidence

The brief identifies `hosted-server.ts` as the AI route composition, but the
current code exposes both spend sites only in `createApiServer`. Its new trusted
`hostedUsage` option installs the meter; hosted invocation composition also passes
the meter for explicit adapters. Existing hosted AI capability gates remain closed.
Enabling new hosted AI routes, durable provider configuration and hosted O dataset
binding are outside this issue. This boundary is tested rather than inferred.

The root build previously failed because the Python SDK workspace has no build
script. Root `build` now uses `--if-present`; actual build-script failures still
fail the command, and Python tests still run under root `npm test`.

Another active task committed `5cf2d6fd` (issue #108 Q-trigger hover styling) onto
this branch during the run. It was preserved, not included in an issue #114
checkpoint or rewritten. Verification covers the resulting branch contents.

## Build and focused checks

- `npm run build`: passed, including strict TypeScript. Vite retains its existing
  advisory about chunks larger than 500 kB.
- `npm run build:demo --workspace=@opensight/web`: passed.
- Focused accounting, AI settings, generative routes and hosted usage run:
  **41 passed / 0 failed / 0 skipped**.
- HTTP tests required local loopback access; the restricted sandbox denied
  listeners with `EPERM`. They passed with that restriction lifted. Provider
  transports were fake; no provider/AWS calls ran.

## Full root verification

Ran `npm test` from the repository root on 2026-10-18 with Node 24.20.0.
The completed command exited 0: **3,146 passed / 0 failed / 24 skipped /
0 cancelled**, 3,170 total. This includes 3,118 Node passes and all 28 Python
SDK tests (`unittest` reported `OK`). Every skip requires live PostgreSQL
(`DATABASE_URL` or live TLS configuration is absent).

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 642 | 0 | 22 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| TypeScript headless SDK | 28 | 0 | 0 |
| Python headless SDK | 28 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 505 | 0 | 2 |
| Web | 1,456 | 0 | 0 |
| Root conformance | 88 | 0 | 0 |

The earlier full-suite process received SIGTERM before completion; it is excluded
from these counts. The complete rerun used a terminal session and local loopback
access. Local logs: `/tmp/issue114-npm-test-final.log`,
`/tmp/issue114-build-final.log`, `/tmp/issue114-demo-build.log`.
No tests or thresholds were weakened to obtain these results. Existing React
test-renderer warnings remain non-failing. No code changed during the final run.

## Static demo inspection

Captured the rebuilt `packages/web/dist/opensight-demo.html` dashboard and author
editor at 1440×900, with HTTP/HTTPS requests blocked. Captures are local artifacts
at `/tmp/issue114-demo/home.png` and `/tmp/issue114-demo/author.png`. Chromium
reported no page errors. The footer still says “Local rendering preview · visual
fidelity not measured”; the artifact is not a deployed server.

Compared the dashboard to `docs/images/sample-dashboard.png` and the editor to
the local QuickSight reference set (`qs-2026/qs-menu-file.jpg`). Dashboard sample
values and chart layout remain intact. The editor retains the Data → Visuals →
canvas order, menu chrome and docked properties. The newer navigation and offline
disclosures differ from older references; no new issue #114 UI change or regression
was identified. This visual inspection does not establish measured fidelity.
Issue #114 changes no frontend UI, so it does not refresh the README imagery.

## Accounting limits

The cap checks recorded spend before transport and records successful completions
after transport. In-flight calls can overshoot; a crash or accounting failure
after provider completion can leave an unrecorded charge. There is no maximum
token reservation, provider invoice reconciliation, model-specific pricing or
email alerting. Zero rate deliberately disables spend checks/warnings. These
limits follow the brief and are documented in D-82; no new product decision was
deferred to the owner.
