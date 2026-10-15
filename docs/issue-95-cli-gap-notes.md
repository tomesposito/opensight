# Issue #95 CLI — verification and demo comparison

Run `codex-issue-95-cli-impl` implements the CLI delivery shape over all 53
implemented v1 REST operations. The command and output contracts are in
[headless-v1-cli.md](headless-v1-cli.md). This slice changes no web UI and does
not publish an npm package, push the build branch or deploy a server.

## Resume and full-suite verification

The interrupted invocation had completed root `npm test` on 2026-10-15 at
03:32 UTC, after the four implementation checkpoint commits. Resume recovered
the complete log through the root conformance summary and independently
reconciled every suite count with it: **2,930 tests — 2,912 passed / 0 failed /
18 skipped / 0 cancelled**. All 18 skips require live PostgreSQL;
`DATABASE_URL` was unset.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| api | 567 | 0 | 16 |
| bundle-parser | 199 | 0 | 0 |
| cli | 73 | 0 | 0 |
| embedding-sdk | 10 | 0 | 0 |
| headless-sdk | 28 | 0 | 0 |
| headless-sdk-python | 28 | 0 | 0 |
| mcp-server | 74 | 0 | 0 |
| o-interpreter | 32 | 0 | 0 |
| parity | 11 | 0 | 0 |
| query-engine | 505 | 0 | 2 |
| web | 1,328 | 0 | 0 |
| root conformance | 57 | 0 | 0 |
| **Total** | **2,912** | **0** | **18** |

No implementation changed during resume. The pending documentation correction
removed a dataset-update example whose pipeline lacked its input binding.
The completed full suite and demo checks were retained rather than repeated.
Artifacts remain outside version control under `.opensight/issue-95-cli-impl/`:
`root-test.log`, `root-test-counts.json`, `demo-build.log`, `browser/`,
`baseline-comparison.json` and `parity/`.

## Executable and contract checks

The 73 CLI tests include exact OpenAPI coverage, one SDK dispatch check per
operation, positional and flag parsing, JSON/YAML/table output, structured
errors, environment credential exchange and SQL bypass attempts. All are
discovered by the existing root workspace test command.

During resume, `node packages/cli/dist/opensight.js --help` rendered the command
tree and `node packages/cli/scripts/generate.mjs --check` confirmed the committed
table was current. The existing executable smoke tests were rerun:
**2 passed / 0 failed / 0 skipped**. They exercise help, missing-token errors,
and a child-process `dataset list` command through the real SDK against
loopback auth/API stubs, including pagination headers and a failed describe.
The sandbox initially blocked the loopback listener; the rerun with local
listener permission passed. Its log is `resume-smoke.log`.

The recovered package dry run contains the executable with its execute bit,
compiled modules, README and Apache-2.0 license. The only direct runtime
dependency is the existing project SDK; no third-party runtime dependency was
added. The Docker dependencies stage includes the CLI workspace manifest.

## Static demo comparison

The interrupted invocation also completed `npm run build:demo --workspace
@opensight/web` and the three reference captures. Resume recomputed their
hashes and compared their bytes with both the MCP and assets baselines:
all three are identical. Browser capture recorded **0 page errors / 0 external
requests**. The reference protocol retains the same viewports, regions,
exclusions and tolerance of 16.

| Reference pairing | Differing pixels |
| --- | ---: |
| editor-classic | 41.22% |
| editor-newlook | 33.58% |
| q-generative | 44.66% |

These are pixel differences, not fidelity grades. No new visible gap was
introduced. Existing findings remain in the [MCP notes](issue-95-mcp-gap-notes.md)
and [assets notes](issue-95-assets-gap-notes.md); no new visual issue is needed.
README feature images and the hero GIF remain current because the web UI is
unchanged. The rebuilt demo is a local static artifact, not a deployed server.

## Scope and integration boundaries

There are no scope deviations. The SDK's dataset/source delete methods gained
an optional idempotency argument so the CLI can forward the existing spec
header without constructing HTTP requests itself. Existing callers retain
their behavior. No REST operation, auth endpoint or concurrency convention was
invented; `SOLUTION_DESIGN.md` and the OpenAPI contract are unchanged.

As specified by D-73/D-70, authenticated commands require an operator-supplied
refresh exchange endpoint. No hosted exchange or Lambda v1 enablement is
claimed. npm distribution also requires the project's SDK dependency to be
published. Those integration/release steps remain outside this build.
