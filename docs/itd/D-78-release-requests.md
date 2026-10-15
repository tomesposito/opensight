---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-15
labels: [itd]
---

### ✅ ITD D-78 — How does a remote developer request and inspect a deployment?

#### CONTEXT

The public build publishes attested artifacts. A private immutable controller
already deploys independently approved compatible releases through OIDC. Public
build success currently gives the remote developer no deployment request or
production status. The operator is authorized to finish this flow under #86.

#### THE PROBLEM

Expose a usable request and status flow without moving AWS approval authority
into the public repository, adding credentials, or presenting a build as live.

#### OPTIONS CONSIDERED

1. Give the public workflow AWS trust or a token for private dispatch.
2. ✅ Use public GitHub deployment requests and an independent operator bridge.
3. Add a continuously running approval/status service.

#### REASONING

Option 2 uses existing tools and costs no standing compute. A public manual
workflow verifies the exact master-build attestation, then creates a production
request binding source and manifest digest. It has only contents-read and
deployments-write permissions. No pull-request trigger, AWS identity or private
credential is added. A request is not trusted approval, regardless of its author
or public status. The operator repeats artifact verification and preserves D-34's
AWS approval binding and compatibility gate.

#### IMPLICATIONS

- Built means an attested release exists; requested/pending means a GitHub
  deployment request exists; approved/queued means the independent AWS approval
  was read back; deploying means dispatch was attempted; deployed/success means
  the matching private run succeeded and AWS state was verified; failure/error
  is never reported as a successful promotion.
- Write a private single-use dispatch intent before the network call. Preserve
  uncertain outcomes. Reconcile the unique token against the private workflow's
  run name; refuse duplicate matching runs, reruns or automatic redispatch.
- Approval and dispatch recheck exact bytes, current authority and configuration.
  CI still cannot write approval objects or update its own trust/policies.
- Reconciliation reads AWS, without SQL or application secrets. Require unchanged
  current-record ETag across inspection, matching images/configuration/alias,
  active functions, positive bounded concurrency, enabled expected queue mappings
  and no active operation. Success also requires the requested current manifest
  and source. Unknown/failed reads never produce a production success claim.
- A separate observed-production record exposes runtime and marketing commits,
  with a timestamp. It is an observation, not a probe of application health.
  Public output is constructed from an allowlist; never publish AWS resources,
  raw errors, private run URLs, receipts or configuration.
- Failed public status publication does not undo or repeat an AWS operation.
  Reconciliation can repair public status. State files stay owner-only outside
  the repository. Concurrent operator commands use an exclusive local lock;
  a crashed lock requires explicit inspection and removal by the operator.
- The private dispatch wrapper accepts the correlation token but the trusted
  reusable controller and AWS OIDC pin remain unchanged. Owner-only master merge
  restrictions still apply. General migration/restore and #85 delivery acceptance
  remain separate work; no compatibility baseline is silently relabeled.

API semantics: [GitHub deployments](https://docs.github.com/en/rest/deployments/deployments)
and [deployment statuses](https://docs.github.com/en/rest/deployments/statuses).
