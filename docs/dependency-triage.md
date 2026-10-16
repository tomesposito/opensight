# Dependency vulnerability triage

Issue #111. Two scanning layers:

- **CI gate** — the `audit` job in `.github/workflows/ci.yml` runs
  `npm audit --audit-level=high` on every PR and master push. It fails on any
  high or critical advisory.
- **Dependabot** — weekly PRs for the `npm` and `github-actions` ecosystems
  (`.github/dependabot.yml`). GitHub Actions updates stay SHA-pinned, matching
  the repo's existing pinning practice.

(The `.github/` files were added by the repo owner via the GitHub web UI: the
automation credential cannot publish under `.github/`. The exact contents are
recorded on issue #111.)

## Severity bar

- **High / critical**: fix before merge. The CI audit job stays red until
  resolved — upgrade the dependency, or replace it.
- **Moderate / low**: triaged as they arrive via Dependabot and bundled into
  the weekly update PR. No emergency, but no indefinite deferral.
- **Unfixable / disputed**: record the decision on the tracking issue with the
  advisory ID, why it does not apply to OpenSight, and a re-check date. Never
  raise the `--audit-level` or add an `.npmrc` exception to make CI green.

## Who reviews

Tom reviews and merges Dependabot PRs. The merge bar:

1. CI green, including the audit job.
2. License check: the update must keep the project's dependency policy —
   MIT/Apache-2.0 for bundled code (repo `AGENTS.md` §2.5; decision HQ-15).
   A license change inside a dependency is a stop-and-decide, never a merge.
3. The repo's normal process otherwise: full test suite green on the branch
   before merging to master.

## Running the scan locally

`npm run audit` (root script) audits every npm workspace at
`--audit-level=high` and exits non-zero on any high/critical finding, the same
gate CI runs. The scan needs access to the npm registry's audit endpoint; on
networks where that endpoint is blocked it fails with a policy/transport error
rather than a clean pass — that is an environment limitation, not a green scan.

## Tool choice

`npm audit` was chosen over OSV-Scanner for the CI gate: this is a plain npm
workspaces monorepo, so the native audit needs no extra tooling, no new
third-party action, and no added trust surface. OSV-Scanner stays the documented
fallback if a future advisory source needs coverage `npm audit` misses.
