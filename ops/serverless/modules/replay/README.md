# Private event replay

Instantiate alongside the runtime with the exact approved image digest and two
runtime database secret ARNs. The separate caller role trusts one explicit
operator principal and invokes only the published numeric version. It cannot
invoke administration, update functions or read secrets. Remove its trust to
stop new sessions; add an explicit `lambda:InvokeFunction` deny to revoke current
sessions immediately. Never grant public CI permission to assume this role.

Invoke with `{ "version": 1, "event": <identifier-only dispatch envelope>,
"acceptAmbiguous": false }`. Ambiguous SMTP requires a separate conscious retry
with `true`, which can send a duplicate. Runtime authority, attempts and retention
still apply. Recovery events, arrays and additional fields are rejected before
credentials are fetched. No HTTP integration is created.

SMTP status on the request function may declare
`OPENSIGHT_WORKER_SMTP_CAPABILITY=configured` only after verifying the work
function's host/from/secret and exact secret permission. Bind both environments
into the reviewed release configuration; the declaration itself grants no mail
permission. Request and replay roles must remain unable to read the SMTP secret.
