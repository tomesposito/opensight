---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-10
labels: [itd]
---

## Purpose

Record the first AWS deployment direction and its relationship to the shipped
single-node reference and the longer-term hosted design.

## Scope

Compute and metadata hosting for a lightly used developer/tester deployment,
idle-cost priorities, and the separation of public code from private operations.

## Out of Scope

Authorization to provision resources, a committed monthly budget, production
availability targets, or approval of unmeasured capacity settings.

### ✅ ITD D-18 — Which deployment should serve the initial developer/tester workload?

#### CONTEXT

The owner expects one human tester and an agent, with long idle periods, and
prioritizes low running cost and automatic wake-up. D11 and HQ-11 already select
serverless execution with PostgreSQL metadata and DuckDB analytical workers.
H8 implements a continuously running process with a lifetime database lock,
in-process scheduler and ephemeral Blaze, so it cannot supply that lifecycle
unchanged. Aurora Serverless v2 now supports automatic pause at zero ACUs on
supported engine versions; D12's original fixed minimum-cost assumption is old.

#### THE PROBLEM

Should the first developer/tester deployment adapt OpenSight for automatic
scale-to-zero or operate the existing single-node stack on a persistent host?

#### OPTIONS CONSIDERED

1. ✅ **Lambda and Aurora Serverless v2 with zero-ACU auto-pause, preceded by a serverless-readiness phase.**
2. One continuously running Fargate task with managed PostgreSQL.
3. A single EC2 or Lightsail host running the existing container stack, optionally stopped between test sessions.

#### REASONING

Option 1 serves the requested idle behavior and preserves D11/HQ-11. The owner
accepted the additional application work rather than an interim VM deployment.
The trade-off is startup latency, plus engineering for durable artifacts,
operation-scoped coordination, asynchronous work and database connection cleanup.
Storage, requests, backups, secrets and maintenance still incur costs; zero ACUs
is not a zero-dollar account guarantee.

Option 2 fits H8 with fewer lifecycle changes, but its continuously allocated
resources and supporting services are unnecessary for the expected traffic.
Option 3 is a useful self-hosting reference and can be inexpensive when stopped,
but manual/scheduled host lifecycle and database administration do not provide
the selected automatic wake-up behavior.

#### IMPLICATIONS

- D11/HQ-11 stand. D12 now selects Aurora Serverless v2 from the first AWS
  deployment, with PostgreSQL as metadata and DuckDB as the analytical executor.
- Skip an interim EC2/Fargate deployment. H8 remains a supported reference;
  its single-process safety lock must not simply be disabled in Lambda.
- Serverless execution activates the H9/H10 correctness prerequisite: ephemeral
  or overlapping invocations must not depend on warm-process identity. Low
  traffic or reserved concurrency of one is not proof of replica safety.
- Use Terraform and GitHub Actions with reusable public code and private
  deployment configuration/control. Credentials, state and backups stay out of
  both repositories. Exact tools/providers remain subject to license review.
- [The phase specification](../aws-serverless-plan.md) separates confirmed
  direction from proposed contracts and implementation gates. It requires a
  reviewed resource plan and estimate before any chargeable deployment.
- HQ-9 canonical-origin scope and HQ-10 best-effort/no-HA commitments continue;
  this decision does not authorize customer domains or broaden data access.

Source: [AWS Aurora automatic pause/resume documentation](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html),
checked 2026-10-10. Engine availability and pricing must be checked again before
deployment; no account-specific observations belong in this decision record.
