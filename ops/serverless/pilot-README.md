# Initial pilot operator

This promotes the existing validation deployment in place under
[D-33](../../docs/itd/D-33-initial-pilot-activation.md). It is an initial activation
tool, not a general redeploy or database recovery command. All commands use the
same external mode-0700 `OPENSIGHT_OPERATOR_DIR`; files are mode 0600. Never put
account configuration, credentials, state, plans or service output in the repo.

Record available database pause/resume evidence. The greater-than-24-hour
measurement is follow-up work; it does not block this initial activation. Build,
test, scan and publish the immutable ARM64 runtime image. Create private
`pilot-release.json` with its exact `image_uri`. Keep the existing
`validation.tfvars.json`, backend and ingress inventory. Run from clean source.

1. `node ops/serverless/pilot-operator.mjs prepare dependencies` selects additive
   queues, roles, log groups, CORS and the pilot ownership tag. Existing functions
   keep their validation settings. The synthetic probe is still available.
2. Run `... plan`, inspect the private plan, then `... apply <planSha256>`.
   Each saved plan is bound to account, deployment, source, private configuration
   and remote state version/lineage/serial, and expires after one hour. The
   operator refuses deletion/replacement and checks resource/cost caps. It never
   falls back to local state. Validation cleanup checks the actual cluster's
   AWS tags and refuses a promoted deployment even with stale local inputs.
3. `... prepare runtime`, then review a fresh `... plan` and `... apply <digest>`.
   This installs durable runtime settings, two workers and **disabled** event
   mappings, and sets synthetic probe concurrency to zero. Request concurrency
   is four, administration one, and each worker two. No provisioned capacity.
4. `... testers` generates `initial-testers.json` once, with separate owner and
   automation workspaces. It uses the approved private `operator.json`
   `alert_email` for the owner; optional `agent_email` defaults to the reserved
   example domain. Passwords and TOTP secrets are never printed or emailed.
   Preserve this file for exact retries; the command refuses to overwrite it.
5. `... invoke migrate`, `... invoke bootstrap-initial`, then
   `... invoke activate-initial`. These IAM-only invocations validate the current
   image, operator credential and strict administration result. The migration
   prepares roles transactionally. Bootstrap creates the two real password/TOTP
   identities; activation is epoch-one-only and cannot reopen later maintenance.
   Each command records a private sanitized receipt. Temporary command payloads
   are removed after invocation, including failures.
6. `... prepare consumers`, review and apply the new plan. This requires the
   activation receipt bound to the image and bootstrap operation. Then
   `... publish-request` publishes the checked request code/configuration using
   AWS revision and code-hash preconditions. Merge the recorded
   `pilot-request-version.json` fields into private `ingress-release.json`,
   preserving the reviewed frontend directory and manifest hash. The ingress
   operator's `prepare`, `plan` and `apply` select that numeric version and four
   authorizer slots. The apex DNS remains absent.
7. Complete real CloudFront startup, password/TOTP authentication, browser S3
   upload/CORS, async ingestion/preparation/query and cross-workspace denial.
   Close clients and observe zero ACU without polling SQL. Record the existing
   release-bound ingress acceptance before the separate DNS cutover plan.

Use private command failure logs to diagnose provider refusals. An ambiguous
administration invocation may be retried with the exact same private payload;
changing credentials or the operation ID is rejected by SQL receipts. Do not
rerun initial migration after bootstrap or use activation to reopen maintenance.
