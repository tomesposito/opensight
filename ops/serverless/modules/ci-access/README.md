# OpenSight ci-access module

GitHub OIDC trust for CI/CD: the OIDC provider, short-lived CI roles with
caller-supplied trust policies and scoped permission policies, and the
optional release watchdog (a guard Lambda that can freeze deployments).

Emergency inline denies are deliberately outside Terraform ownership: a
normal apply cannot remove an incident shutoff. Recovery is a separate
operator action.

## Inputs

Trust documents and policies arrive as validated JSON strings from the
operator. See `variables.tf` and `ops/serverless/ci-policy.mjs` for the
policy builders.
