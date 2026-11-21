# AWS and GitHub operator readiness

D-95 records the contract for issues #110, #117, #209 and #236/#111.
All deployment inputs, plans, state, receipts and raw mail stay outside Git.

## Dependency audit

CI installs the committed lockfile using Node 24 and runs `npm run audit`.
High or critical findings fail the audit job and block release publication.
The audit job has only repository read access and no cloud credentials.
See `dependency-triage.md` for handling findings.

## Contact mail

`ops/serverless/mail-forwarder-template.mjs` generates the isolated stack.
Supply deployment, domain, verified destination and public hosted-zone ID as
private parameters. Initially leave `PublishMx=false`. Review the change set;
create the stack; verify both aliases and duplicate-event handling. Activate the
new SES receipt-rule set only after checking that no existing active set would
be displaced. Then review the one-record change set with `PublishMx=true`.
Send an external test to each alias and verify arrival at the configured mailbox.

The stack accepts exactly support/privacy at the configured domain and forwards
only to its single verified destination. The raw original is attached, with fixed
forwarding headers. SES v2 raw content requires the narrowly scoped SES send/raw
send permissions on the exact sender and verified destination identities, with
fixed sender/recipient conditions. Incoming spam/virus failures and oversized mail fail closed.
The account remains in the SES sandbox.

Raw messages expire after seven days; send receipts after thirty. Logs and the
failed-invocation queue retain seven days. Review failed invocations and named
errors during operations. A claimed receipt or ambiguous send requires operator
reconciliation against provider/mailbox evidence; never delete the claim and
blindly replay it. Completed duplicate events do not send again. Receipt-rule
activation is an explicit regional operation outside CloudFormation.

## Application sender

The mail and compute modules accept an independent `smtp_from_address`; the mail
module additionally requires its exact verified `smtp_identity_arn`. Defaults
preserve older installations. Changing the sender must retain the existing single
sandbox recipient and budget-alert address. Do not create new SMTP keys. Update
runtime configuration through the independent release boundary and retain before/
after fingerprints. Verify the received message's SPF, DKIM and DMARC results.

## Static Content Security Policy

Generate the policy with `static-security-policy.mjs` using exact application and
artifact origins. Render `edge-static-response.js` with the JSON-encoded policy
and publish a CloudFront viewer-response Function. Free pricing plans reject custom
response-header policies. Keep the managed security headers and existing request
functions; reject any conflicting response function. Attach only to the two frontend-origin behaviors; dynamic API
and embedding responses keep their own policies. Validate browser authentication,
uploads, queries, marketing and the demo before enforcing it. Inline scripts and
`eval` are denied. Existing styling still requires inline styles.

Hosted packaging externalizes the demo's single executable module as the fixed,
manifest-bound `marketing/demo/app.js`. The downloadable offline demo remains
self-contained. During cutover only, the previous hosted module may be admitted
by its exact SHA-256 hash. Remove that hash after the new bundle is verified.
Changing the fixed marketing manifest also requires reviewing and updating the
private deployment controller's pinned frontend policy before release selection.

CloudFront omits viewer-response Functions when the origin returns status 400 or
higher. Those responses retain the managed security headers but do not receive
this CSP. API and embed behaviors never receive this static response function.
