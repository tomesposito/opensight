# Issue #95 assets slice — review gate and baseline verification

2026-10-13, branch `work/issue-95-assets`. This checkpoint contains a
contract proposal and draft IDD D-41. **The assets implementation is
blocked on product review**, as required by the frozen contract's rule
that product-shaped questions come back for review rather than freezing
silently. The [slice document](headless-v1-assets.md) names the seven
questions and the exact resume boundary. No asset endpoint, search
index, or mutation validation is claimed as implemented.

## Verification

Full root `npm test` exited 0: **2,646 passed / 0 failed / 18 skipped /
0 cancelled**. The slice document records per-suite counts. All skips
explicitly require live PostgreSQL (`DATABASE_URL` is unset).

`node ~/workspace/goals/opensight/hidden_files/build-demo-shim.mjs`
rebuilds the static demo after publish. This is not a deployed server.
Runtime sources, dependency manifests, `SOLUTION_DESIGN.md` and
`docs/api/openapi-v1.yaml` match the master base (`44bb1099`).
Document links resolve locally and `git diff --check` passes. Nothing
was merged or pushed at the time this checkpoint was written; there
were no new dependencies or AWS calls.

## Corrections to the contract draft

While grounding the proposal, one gap in
`docs/api-contract-v1-draft.md` §5 turned out to be stale: **move/copy
do exist** locally at `POST /api/assets/(analysis|dashboard)/{id}/(move|copy)`
(`packages/api/src/organization.ts`). The real gap is narrower — the
verbs are unversioned, admin-only, and limited to analyses/dashboards,
and there is no rename verb. The slice document corrects this and
proposes versioning with a changed who-can rule (Q2) and grant-reset
copy (Q3), rather than versioning the local behavior as-is. The
draft's search and permissions-beyond-shares gaps stand: there is no
server search endpoint (the UI search is client-side local drafts
only), and there are no permission verbs beyond share grants and
folder permissions.

## Dependencies restated, not re-decided

- Who-can-grant (Q4) and who-can-move/delete (Q2/Q5) mirror the rule
  D-39 Q2 proposes for analysis edit/delete; D-39 owns that rule.
- Published-dashboard preservation on source-analysis delete (Q5)
  restates D-40 Q5; D-40 owns it.
- Reader access through shares (Q4) follows D-40 Q6 (readers see data
  only where they independently have dataset access, per HQ-4).
- Asset rename is not decided here; it belongs to D-39's authoring
  verbs for analyses.

## Offline capture and reference comparison

This slice changes documentation only, so no new captures were taken:
there is no UI delta to compare. The demo rebuild is byte-equivalent to
the dashboards slice's rebuilt demo for the static assets (docs are not
shipped in the demo bundle). No new user-visible gap was introduced; no
issue was filed or scheduled by this proposal. No visual-parity claim
is made and README media is unchanged.
