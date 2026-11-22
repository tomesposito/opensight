# Issue #308 — verification and visual notes

The static demo was rebuilt with `npm run build:demo --workspace=@opensight/web`.
Desktop captures at 1280×800 show zero changed pixels for the dashboard and
connector gallery against the saved pre-change demo. The gallery also matches
`docs/images/data-sources.png` exactly. Captures found no page errors, external
HTTP requests or horizontal overflow. No UI implementation or media changed,
and no new visual gap was identified. The static demo is a local artifact,
not a deployed server; QuickSight visual fidelity remains unmeasured.

Captures, comparisons and full-suite logs are retained in the ignored
`.opensight/issue-308-verification/` directory. Browser captures completed before
the full root test run. The screenshot pass used the installed Playwright
headless shell.

The focused download regression run passed 12 tests, with no failures or skips.
The additional stalled-response deadline regression passed independently.
Earlier local and hosted download contract checks also passed. See
[download admission](issue-308-download-admission.md) for memory allowances,
response ownership, cancellation and egress semantics.

The first completed root run passed all non-web workspaces; its web browser
checks failed or were cancelled on Chromium pipe resets. Directly launching
`/opt/meta-chromium/chrome` against `about:blank` exited 13 with
`Hatch WebGL domain policy is required for browser startup`. The full root
suite was rerun with `OPENSIGHT_CHROMIUM` pointing to the installed Playwright
headless shell. No browser test was skipped or weakened. An earlier command
runner attempt ended with status 143 during compilation, before tests; subsequent
full runs used a persistent terminal.

No dependencies, package manifests, lockfiles or `SOLUTION_DESIGN.md` changed.
All commits remain on `work/issue-308-download-admission`; no merge or push,
AWS call or external service access was performed.

## Full root verification

The final root `npm test` exited **0**: **8,208 passed / 0 failed / 38 skipped**
across 8,246 tests, including all 32 Python SDK tests. There were no cancellations
or todos. All skips require live PostgreSQL: 37 require `DATABASE_URL`, and one
requires a configured live TLS PostgreSQL server.

The run used `TZ=UTC`, `TMPDIR=/tmp`, no `DATABASE_URL`, and
`OPENSIGHT_CHROMIUM=~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`
(with the home directory expanded in the actual command). Browser captures did
not run concurrently. The full log, exit status and parsed counts are retained
as `root-npm-test.log`, `root-npm-test.exit` and `root-test-counts.json` in the
verification directory.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| @opensight/api | 1,560 | 0 | 36 |
| @opensight/bundle-parser | 213 | 0 | 0 |
| @opensight/cli | 73 | 0 | 0 |
| @opensight/embedding-sdk | 10 | 0 | 0 |
| @opensight/headless-sdk | 28 | 0 | 0 |
| opensight-headless-sdk-python | 32 | 0 | 0 |
| @opensight/mcp-server | 74 | 0 | 0 |
| @opensight/o-interpreter | 42 | 0 | 0 |
| @opensight/parity | 11 | 0 | 0 |
| @opensight/query-engine | 2,621 | 0 | 2 |
| @opensight/web | 3,425 | 0 | 0 |
| root-conformance | 119 | 0 | 0 |
| **Total** | **8,208** | **0** | **38** |
