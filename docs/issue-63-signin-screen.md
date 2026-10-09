# Issue #63 — hosted sign-in screen

The supplied issue brief is the implementation contract; HQ-3 and HQ-7 are
settled. `SOLUTION_DESIGN.md` is unchanged. The work stays on
`work/issue-63-signin-screen` without merging, pushing or opening a PR.

## Session configuration

`OPENSIGHT_SESSION_SECONDS` now enforces HQ-7's inclusive 900–36000 second
(15–600 minute) range. Previously the validator accepted 1–86400 seconds.
Out-of-range deployments fail startup with `HOSTED_CONFIG_INVALID`; operators
must use the settled range. The login payload and authentication verifier are
unchanged. Invitation lifetimes are unchanged.

Further implementation and verification results are recorded at checkpoints.
