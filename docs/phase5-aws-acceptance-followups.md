# Phase 5 — AWS acceptance follow-ups for issues 85, 86 and 94

The October 15 review used public source `1b29236` and deployed application
source `8b2481b`. The bounded migration/deployment tooling is still under review
in PR #99. No issue is considered complete merely because its source merged or
its build artifact exists.

## Queue monitoring (#85)

Applied the four alarms from `ops/serverless/monitoring` through a saved plan
containing four creates and zero changes to existing resources. Their private
state uses the existing encrypted, versioned, locking backend. The work DLQ alarm
detected the previously retained backlog; recovery/Scheduler DLQ and source-age
alarms evaluated OK. No message was deleted or redriven. These alarms have no
notification or automatic recovery actions and make no database queries.

A synthetic prepared-dataset refresh passed through a real one-shot Scheduler
entry, SQS and the work Lambda, recording a succeeded occurrence. The schedule
was stopped and its prepared dataset removed afterward. The first probe correctly
failed `BLAZE_MODE_REQUIRED` because its dataset used direct-query mode; the
successful probe explicitly configured BLAZE before arming the schedule. This is
scheduled-refresh acceptance, not report/alert or crash-recovery acceptance.

The current application exposes durable job endpoints. A request to
`/api/api/automation-status` reports durable events but SMTP not configured,
although the separate work Lambda has the approved SMTP references and exact
secret permission. The request Lambda must not gain SMTP credentials simply to
change this status; remote development should expose truthful worker capability
without widening the request role.

Both deployed and latest-source ingress reject `/api/api/v1/analyses`, dashboards,
datasets and sources. The v1 implementations exist behind that boundary. Live
report/alert setup therefore needs a reviewed route/runtime integration or a
bounded private synthetic fixture. Do not remove the path allowlist globally.
Operator replay also needs a dedicated replay-only entrypoint before an IAM role
can safely grant access: the existing administration entrypoint accepts broader
commands, and IAM cannot constrain its JSON command field.

Remaining acceptance includes real report/alert delivery to the already approved
recipient, current-authority/revocation failures, ambiguous SMTP acceptance and
actual worker/SQS crash/redelivery/recovery evidence. Local fault-injection tests
are evidence for the protocol, not those cloud outcomes.

## Deployment automation (#86)

The existing private OIDC workflow and public build/release separation remain in
place. Public build success is not permission to deploy. Compatible deployment
requires independent approval bound to exact source, manifest, current release
and configuration. The latest source also changes the conservative compatibility
fingerprint; it cannot use the routine compatible-only path without reviewed
maintenance activation.

Remote development still owns executable plan/apply/migration/restore controllers,
the release request/approval/status flow and bounded startup-readiness handling.
Current `workflow-templates` are not executable infrastructure or restore
orchestration, and `deploy-protocol.mjs` is an offline evidence state machine.
Restore requires the independent deletion/revocation/fence registry and isolated
restore acceptance described by D-25; a retained snapshot alone is insufficient.
AWS role/trust changes must follow exact controller contracts and artifact pins.
No public PR job gains AWS trust, and no standing IAM user is needed for CI.

## Marketing cutover (#94)

Issued and DNS-validated an ACM certificate covering both the apex and app
subdomain. The earlier app-only certificate cannot cover both aliases on one
CloudFront distribution. Matching existing ACM validation CNAMEs were reused.
Certificate identities and DNS receipts remain private. The new certificate is
not attached, and public traffic still serves the current application at the apex.

The next implementation should retain the existing Free CloudFront distribution:
route the marketing apex and app host to separate private S3 prefixes, accept API
traffic only for the app origin, and preserve forged-header/private-origin checks.
Include the marketing assets and built offline demo in the hash-bound, attested,
durably retained release bundle. An expiring unbound site artifact is insufficient.
One option is a `marketing/` subtree inside the existing frontend bundle, extending
its file manifest and media content types while retaining HTML-last publication.
The remote implementation must also test host/cache separation, demo links and
matched rollback. AWS cutover then updates aliases/certificate, edge functions,
DNS, exact application/auth/embed origins, S3 CORS, private smoke configuration and
configuration fingerprints under the deployment lock. Verify the active Free plan
and both sites before recording success.

## Verification

The private GitHub Actions preflight completed successfully after these AWS
changes (run `38760475079`). The compatibility baseline and application traffic
were unchanged. The full root `npm test` passed **2,985 / failed 0 / skipped 0 /
cancelled 0** on Linux ARM64 with live PostgreSQL and Chromium. Monitoring
OpenTofu validation and both mock-plan cases passed. The rebuilt static demo and
1280×800 Home screenshot were byte-identical to the prior reference; there was
no UI change requiring new README media. Staged secret and portable-path checks
passed. Private evidence and credentials are excluded.
