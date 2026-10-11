# Phase 5 SR4b6 — buffered request completion

After successful 8 MiB ingestion, AWS POST query returned EXECUTION_CANCELLED in
about 2.5 seconds. The synthetic IncomingMessage in the Lambda HTTP bridge has
complete=false; Node emits aborted on normal body EOF. Mark the request complete
before exposing EOF because the gateway body is already fully buffered and
validated. Retain real invocation abort propagation and cleanup. Prove the bug
with a failing real hosted POST compute regression, then verify success and
explicit abort behavior. Do not change timeout, memory or security limits.

For this compatible pre-DNS application replacement, add a distinct private
request-repair selection. Preserve the original activation receipt and the
connection-repair record. A new strict version-one request-repair record binds
account, deployment, original bootstrap operation, original activation image,
previous application image, target image/source commit and purpose
complete-buffered-http-requests. Validate the existing connection repair against
the previous image before validating this second step. Both images must be pinned
to the owned ECR repository; the source must be an ancestor of the clean checkout.
Require current request/work/recovery functions to be active on the previous
image, current pilot runtime/consumers, and absent apex DNS. Select only once;
no arbitrary upgrade or general release mechanism. Configuration receipts include
both provenance records. Initial commands stay closed except the already-frozen
execution extension, whose original activation HMAC is preserved.

Use the existing saved-plan apply, immutable request version and separate ingress
selection. Keep SQL epoch/state/budgets, identities and accepted work unchanged.
No new dependency, public route or provisioned service. Rebuild and screenshot
compare the demo, run the full root suite and focused regression tests, smoke and
scan the exact image, and repeat real browser acceptance before DNS publication.
