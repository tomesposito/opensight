# Issue #95 dashboards slice — review gate and baseline verification

2026-10-13, branch `work/issue-95-dashboards`. This checkpoint contains a
contract proposal and draft IDD D-40. **The dashboards implementation is
blocked on product review**, as required by D-38 (who-can-publish carried
to this slice) and the frozen contract's rule that product-shaped
questions come back for review rather than freezing silently. The
[slice document](headless-v1-dashboards.md) names the seven questions
and the exact resume boundary. No dashboard endpoint, version storage,
or mutation validation is claimed as implemented.

## Verification

Full root `npm test` exited 0: **2,646 passed / 0 failed / 18 skipped /
0 cancelled**. The slice document records per-suite counts. All skips
explicitly require live PostgreSQL (`DATABASE_URL` is unset).

`npm run build:demo --workspace @opensight/web` exited 0 and rebuilt the
local static demo and embed artifacts. This is not a deployed server.
Runtime sources, dependency manifests, `SOLUTION_DESIGN.md` and
`docs/api/openapi-v1.yaml` match the master base (`1c86c426`). Document
links resolve locally and `git diff --check` passes. Nothing was merged
or pushed; there were no new dependencies or AWS calls.

## Offline capture and reference comparison

This slice changes documentation only, so no new captures were taken:
there is no UI delta to compare. The demo rebuild is byte-equivalent to
the analyses slice's rebuilt demo for the static assets (docs are not
shipped in the demo bundle). No new user-visible gap was introduced; no
issue was filed or scheduled by this proposal. No visual-parity claim
is made and README media is unchanged.
