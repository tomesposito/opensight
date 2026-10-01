# Issue #30: Run it verification

The README now leads with [Run it](../README.md#run-it), ahead of features and
the contributor quickstart. The [first-run](first-run.md) and
[local-data](local-data.md) guides describe the same two-terminal local flow,
sample Home, CSV preparation, live chart, and device-local draft behavior.
The static demo remains a separate no-backend preview.

## Fresh-build failure and fix

On 2026-10-01, a tracked-file export of `87efc191` into a new temporary directory
had no `node_modules`, compiled output, generated web fixtures, `.env` files or
saved pipelines. With Node 24.20.0 and npm 10.9.4, `npm ci` passed (91 packages).
The host's existing Node/npm installation and package cache were reused.
`npm run build --workspace @opensight/api` then failed with TS2307:
`packages/web/src/api-client.ts` could not resolve `@opensight/o-interpreter`.

The API build compiled the web compiler before building the interpreter it
imports. Building the interpreter first fixes that dependency order, including
the root contributor build, which starts with the API workspace. No application
behavior, dependency, screenshot, README GIF, or `SOLUTION_DESIGN.md` change is
needed.

## Verified local startup and browser workflow

A second clean tracked-file export includes the dependency-order fix in
`bc88d74e`. Every command below ran from that export's repository root, with
no hosted/API overrides or external database settings:

| README command | Observed result |
| --- | --- |
| `npm ci` | Exit 0; installed 91 packages without warnings on the successful run. |
| `npm run build --workspace @opensight/api` | Exit 0; built dependencies, compiler, API and embed assets from unbuilt sources. |
| `npm start --workspace @opensight/api` | Printed `OpenSight API listening on http://127.0.0.1:3000`; stayed running for acceptance. |
| `npm run dev --workspace @opensight/web` | Prepared two pinned fixtures; Vite served `http://127.0.0.1:5173/` in terminal 2. |

The environment's 512 MiB temporary filesystem could not hold two installed
copies. An intermediate install emitted ENOSPC warnings despite exiting 0; its
partial output was discarded. The successful sequence started again with one
clean copy. Listening sockets require execution outside the filesystem sandbox.
An existing default development API occupied port 3000; it was stopped so the
browser used the newly built API, not an older process.

The repeatable [browser acceptance script](../packages/web/scripts/verify-readme-run-it.mjs)
connects to those actual CLI processes, with a fresh Chromium context and no
saved browser state. It reads the URL from the README and never starts an API
or Vite through library helpers. It uses the pre-existing external Playwright
tools (`OPENSIGHT_SCREENSHOT_TOOLS`) and Chromium (`OPENSIGHT_CHROMIUM`), adding
no repository dependency.

Direct Chromium navigation reported
`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. With `OPENSIGHT_BROWSER_BRIDGE=true`,
the script forwards the browser's HTTP requests through Node to the real local
servers. Chromium still opens **http://127.0.0.1:5173/**, with the same origin,
paths, methods, request bodies and server responses. No API response is mocked;
the Vite `/api` proxy and real DuckDB queries are exercised. HMR WebSockets and
external requests are blocked by the acceptance harness.

Observed in Chromium:

1. Local workspace opens without sign-in. Home renders five pinned sales
   visuals and explains the fixed East-region sample. Home sends no query.
2. Data → Data sources → Upload a file stages a synthetic CSV with North/2,
   South/3 and North/4: three rows, two inferred columns.
3. Prepare this upload opens Data preparation. A calculated `doubled` column
   (`{amount} * 2`) and North filter show exactly North/2/4 and North/4/8.
   Save pipeline succeeds.
4. Build a chart → Add visual → assign `doubled` renders a real prepared-data
   chart: North has amount 6 and doubled 12. No sales-fixture query substitutes
   for the uploaded data.
5. Save draft confirms device-local persistence. After navigating to My analyses
   and reloading, Reopen restores the title, draft URL and rendered chart.

The run exits 0 with **four prepared queries, zero page errors and zero external
requests**. Home, preparation and saved-chart captures were reviewed as acceptance
evidence; the published screenshots and GIF remain unchanged because the UI did
not change. Raw logs and captures are in ignored `.opensight/issue-30/`.

## Drift guard

[Root conformance tests](../conformance/readme-run-it.test.mjs), included by the
existing root `npm test` glob, extract the Run-it Bash commands. They check
workspace/script existence and install/build/start order, compare documented
URLs and ports with the API CLI defaults and resolved Vite configuration, and
require the first-run command sequence and local-data links to agree. All three
targeted checks pass. The guard complements the real fresh-build/browser check;
it does not claim that script existence alone proves a runnable product.

## Contributor commands

`npm run build` from the repository root exits 0. The first attempt was
terminated with exit 143 during compilation; a complete retry outside the
sandbox passed. The normal Vite bundle-size advisory remains unchanged.

The previous README bundle-parser command failed with ENOENT: npm changes to
`packages/bundle-parser` when running the workspace script. The corrected command
is verified from the root and exits 0:

```bash
npm run summarize --workspace @opensight/bundle-parser -- ../../fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs
```

The README now links to this archive's expected JSON summary and identifies the
existing synthetic CLI snapshots separately. No CLI behavior change was needed.

## Static preview

`npm run build:demo --workspace @opensight/web` exits 0 and rebuilds
`packages/web/dist/opensight-demo.html`. Chromium opened this local file in a
fresh context with both temporary verification servers stopped. Home rendered
five sample visuals; Upload to staging and Save pipeline were disabled. The run
reported zero page errors and zero HTTP requests. Its Home capture was visually
compared with `docs/images/sample-dashboard.png`: navigation, sample notices,
layout and chart values agree. This is a local static preview, not a deployed
server or a visual-parity measurement. The existing README images are unchanged.

## Final full-suite results

The required command ran from the repository root after the implementation,
documentation corrections, builds and browser acceptance:

```bash
TZ=UTC DATABASE_URL=postgresql://postgres@localhost:5433/opensight npm test
```

It exits 0: **1,560 passed / 0 failed / 0 skipped**, with no cancelled tests.
All live PostgreSQL checks ran. Strict TypeScript checks and workspace builds
are included in the test scripts.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 255 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 512 | 0 | 0 |
| Web | 554 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,560** | **0** | **0** |

The full suite covers implementation through `d68a8430`; the final checkpoint
only records verification evidence. `git diff --check` passes. Temporary servers
and clean-copy files were removed, and the pre-existing default development API
was restored on port 3000. No merge, push, deployment or issue closure was made.
