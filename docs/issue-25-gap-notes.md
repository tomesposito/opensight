# H5 (#25): verification and visual review

Work is on `work/issue-25-h5-embed-config`, based on `4576de1c` from `master`.
[SOLUTION_DESIGN.md](../SOLUTION_DESIGN.md) and dependency versions are unchanged.
No new dependencies, external network calls, AWS calls, installation, deployment,
merge, push or issue closure are part of this slice. API resources, operator
configuration and open decisions are documented in
[embedding-config.md](embedding-config.md).

## Acceptance coverage

Nine new API tests exercise durable revisions, simultaneous replacements (one
winner, one 412), transaction rollback including session revocation and outbox,
H2 membership/admin/lifecycle checks, H3 revision invalidation, policy reductions,
exact host/parent origins, tenant-owned raster references, operator ceilings and
unsupported capabilities. Bypass cases include scripts, event attributes,
`javascript:`/external URLs, CSS `url()`/`expression()`, encoded markup, oversized
labels, forged principals, cross-tenant asset IDs and malformed/animated PNGs.
Existing v1 embedding regression tests remain in the full suite. The existing
live-Postgres H2 test now also checks H5's operator-table privacy and concurrent
revision behavior; that integration test requires a local PostgreSQL installation.

Five new renderer tests cover all four states with both branding presets,
invariant notices, suppression of protected content outside ready state, escaping
and rejection of unsafe image sources. The separate offline Chromium harness
passed its assertions and produced twelve screenshots: eight state/brand frames,
two full matrices, one alternate palette and one mobile-width view. It checks
iframe accessibility titles, PNG logo/favicon behavior, permission messages,
retained notices, absence of unsupported controls and horizontal overflow.
Zero external requests and zero page errors were recorded.

The first full run exposed an inherited H3 test-clock mismatch: upload expiry
used real time after worker execution, while the service used an injected frozen
clock. On this VM, execution took more than the test's one-second allowance. The
failure reproduced independently. Both expiry and advancement now use the
fixture clock; the isolated regression passes. No source/runtime behavior changed
for this correction.

## Static demo and README

`npm run build:demo --workspace=@opensight/web` rebuilt the single-file main demo,
v1 renderer and offline embedding preview. The main demo was captured at
1440×1000 with external HTTP blocked, recording no page errors, external requests
or horizontal overflow. Comparison with `docs/images/author.png` and
`qs-author-light-flow.jpg` retains the existing Data → Visuals → sheet flow,
docked properties and static-demo notices. Main-builder behavior did not change.
This is a local static demo, not a deployed server; visual fidelity is not measured.

The new preview was reviewed at desktop and mobile widths. Every state retains
notices and clear permission/expiry text; palette and logo changes do not disguise
the state. Chromium's full-page capture initially omitted offscreen mobile iframe
surfaces; the capture script now paints the full mobile-width document before
capture. This was a screenshot-harness issue, not missing application states.
Review images are [default branding](images/embed-preview-default.png) and
[sample Atlas branding](images/embed-preview.png).

The README includes the new preview and links to its limits. Its hero GIF was
regenerated using the supplied `readme-gif.mjs` harness against the rebuilt local
HTML, with a fixed frame count for its hold intervals on this VM, then the supplied
ffmpeg palette/assembly commands. Existing unrelated feature screenshots retain
their matching UI. No new user-visible regression was identified; no new external
issue was filed under the no-network instruction. HQ-5, HQ-6, HQ-7 and HQ-9/H11
remain open in the existing phase plan; no new product scope is inferred.

Local evidence: `/tmp/h5-preview-capture.log`, `/tmp/h5-embed-preview/`,
`/tmp/h5-main-capture.log`, `/tmp/h5-main/`, `/tmp/h5-readme-gif.log`,
`/tmp/h5-gif-assembly.log`, `/tmp/h5-demo-build.log` and
`/tmp/h5-h3-expiry-fixed.log`. The checked-in capture script reproduces the preview
assertions without downloading a browser or adding a project dependency.

## Full verification

The final root `TZ=UTC npm test` exited **0** with **1,455 passed / 0 failed /
9 skipped**. All skips are live PostgreSQL integration tests: seven in the API
workspace and two in the query engine. This VM has no installed PostgreSQL
binaries or configured `DATABASE_URL`; no apt/package installation was attempted.
The skipped parent suites do not enumerate their nested tests, so totals are not
directly comparable to the previous all-Postgres run. Strict TypeScript and package
public-entry checks ran as part of the workspace test commands.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 241 | 0 | 7 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 496 | 0 | 2 |
| Web | 482 | 0 | 0 |
| Root conformance | 3 | 0 | 0 |
| **Total** | **1,455** | **0** | **9** |

The final run verifies implementation checkpoint `b548ded2`; subsequent changes
are review notes and refreshed README artifacts. Evidence is
`/tmp/h5-verified-tests.log` and `/tmp/h5-verified-tests.exit`. `git diff --check`
passes. All requested implementation and review artifacts are committed on the
requested branch. Merge, publication and issue closure remain with the watchdog.
