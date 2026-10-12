# Private workflow templates

**These are templates, not live workflows.** They document the intended
private deployment orchestration for the operator's private repository.
They are never copied into `.github/workflows/` of the public repo, and
they grant zero AWS trust to public PR jobs.

## Design

- Manual `workflow_dispatch` only, on a protected private ref.
- Short-lived GitHub OIDC (`id-token: write` only on the job needing it).
- Separated privileges: plan / apply / deploy / restore assume different
  roles (see D-36). No single workflow holds all capabilities.
- One environment concurrency group (`cancel-in-progress: false`) serializes
  apply, deploy, rollback, and maintenance.
- Every template verifies the release manifest and approval envelope before
  touching AWS; stale plans, changed artifacts, or drift fail closed.

## Templates

- `plan.yml` — read-only plan: reads config/state, writes only its lock and
  the private plan record. Produces the digest-bound plan envelope.
- `apply.yml` — applies a reviewed plan envelope: reacquires the lock,
  verifies the envelope digest, drift, and expiry; never creates a
  replacement plan implicitly.
- `deploy.yml` — application deploy: verifies the release manifest and
  approval, runs the release controller (`preflight` then `deploy` modes),
  serialized through the operation record.
- `restore.yml` — fail-closed restore: requires explicit operator
  authorization, verifies registry/object/key evidence, holds tenants
  suspended, never blindly redrives queues.

## Public-repo rule

The public `ci.yml` builds and publishes releases. It never assumes AWS
roles, never handles deployment secrets, and its publish job is gated to
`refs/heads/master` non-PR runs. A public merge or tag never deploys.
