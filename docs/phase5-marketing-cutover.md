# Phase 5 — Marketing deployment and hostname cutover

[D-77](itd/D-77-marketing-cutover.md) freezes this operator-owned change (#94).
The public repository builds artifacts; it receives no AWS trust. The private
controller remains manual, pinned by full commit and independently approved.

## Release contents

The tested container builds the hosted frontend, then the offline demo. It checks
`site/` and packages its approved public files plus `demo/index.html` under the
frontend archive's `marketing/` directory. The frontend manifest and attested
release bind every file. A master build also uploads the same subtree as
`site-<sha>` with seven-day retention. Operators deploy from the durable attested
release; the convenience artifact is not a replacement for attestation.

`package-sites.mjs` rejects links and missing assets. `frontendFiles` rejects
partial marketing bundles. `frontendMetadata` uses correct image/video MIME types,
five-minute caching for unhashed marketing assets and no caching for HTML. Hosted
hashed assets keep their existing immutable cache policy.

## One distribution, two hosts

With `marketing_origin` unset the ingress module preserves the original topology.
For cutover, supply exact HTTPS apex `marketing_origin`, its `app.` subdomain as
`public_origin`, and an issued `frontend_certificate_arn` covering both names in
the edge region. The operator must verify ACM status, account and SANs explicitly.
The existing apex/API certificate and API origin domain are retained.

`edge-static.js` attaches to **both** static behaviors. It validates the Host and
rewrites apex requests to `/marketing/...`; app requests retain their product
paths. Unknown hosts, unsafe paths, marketing-prefix requests and cross-host
application paths fail closed. `/demo` redirects to `/demo/`. Both behaviors keep
the existing private S3 origin. Dynamic behaviors retain `edge-viewer.js`, bound
to the app origin only. No new distribution, bucket, WAF rule, NAT gateway,
provisioned concurrency or paid subscription is required.

## Initial operator cutover

Keep plans, state, rollback snapshots, operation records and all real inputs in
protected operator storage outside either repository. Use the existing encrypted,
versioned and locked state backend. The operator performs these steps; they are
not permissions granted to the CI deploy role.

1. Merge the reviewed public build/routing change and private controller change.
   Pin the caller and OIDC subject to the reviewed immutable controller commit,
   keeping the existing token-issue-time revocation cutoff. Verify private OIDC
   read access. Public master CI must finish and attest the chosen source.
2. Verify the exact master release manifest and provenance with the pinned `gh`
   CLI, then verify and safely extract `frontend.tar.gz`. Select only its complete
   `marketing/` subtree for the initial cutover. Keep the deployed hosted files,
   four image digests, source and runtime compatibility unchanged.
3. Refresh live configuration, alias/version, concurrency and queue mappings,
   certificate SANs, Free subscription, CORS, CloudFront ETag, current release
   and deployment configuration. Verify each current frontend object's digest.
   Save a private rollback copy of all of these. Reject any unexplained drift.
4. Review a saved ingress plan through `checkIngressPlan` and `checkCutoverPlan`:
   three updates (distribution, dynamic viewer function, authorizer origin) and
   three additions (static viewer function, app A/AAAA). No replacements/deletes.
   Prepare an isolated CORS plan and explicit `originPatch` changes for the three
   runtime functions. Reject a broad runtime plan that changes other environment
   fields, images, permissions or resources. Preserve issuer/audience, secrets,
   epoch, egress, limits and SMTP settings exactly. Review saved-plan digests.
5. Recheck all saved bindings and acquire `ci/operations/active.json` with
   `If-None-Match: *`. Arm and verify the existing one-shot watchdog before any
   traffic mutation. Record phases with ETag compare-and-swap. The watchdog only
   stops admission; it never completes or rolls back a cutover.
6. Disable both event mappings and set all four functions' reserved concurrency
   to zero. Verify disabled/zero state and wait the maximum prior timeout plus
   ten seconds for admitted invocations. This necessary drain is bounded;
   CloudFront propagation is also bounded by the operation's watchdog deadline.
7. Publish the verified marketing subtree, media first and HTML last. Apply only
   the reviewed origin patches and CORS plan; publish a request version and move
   the `live` alias using its current revision. Apply the exact saved ingress plan
   while admission remains closed. Verify CloudFront is Deployed, both DNS aliases
   and shared certificate, and the current origin settings before proceeding.
8. Update private CI configuration with `publicOrigin` and `marketingOrigin`, and
   its synthetic smoke configuration with matching `origin` and `marketingOrigin`.
   This invalidates old configuration-bound approvals. Invalidate cached objects
   and wait for completion. Restore only the saved concurrency/mapping settings.
9. Run `verifySites` against the exact combined frontend hashes; check apex,
   product, demo/redirect and cross-host API denial. Run the existing synthetic
   HTTPS/MFA/upload/ingestion/refresh/query/isolation smoke on the app origin.
   Check browser S3 preflight permits the app origin and no longer the apex.
   Read back configuration fingerprints, images and request alias.
10. Construct a composite record with `cutoverRelease`, supplying the newly
    verified numeric request version. Its runtime source/image/
    compatibility stay unchanged; `marketing.source`/`manifest` identify the
    separately attested site. CAS the current record against its saved ETag,
    mark the operation complete, cancel the watchdog and release the lock.
    Refresh private IaC inputs for subsequent origin plans and retain evidence.

A failed or uncertain step stays held. Do not delete the lock, reopen traffic or
retry an ambiguous state commit. Reconcile live state first. To reverse this first
boundary, keep admission closed and restore **together**: prior viewer code and
associations, aliases/certificate/custom origin header, original function origins,
artifact CORS, exact old request alias, verified frontend bytes, CI/smoke config
and current release pointer. Use a newly reviewed rollback plan from actual state;
do not apply a stale forward plan backwards. Wait for edge deployment/invalidation,
then test the original origin before recording a verified rollback and reopening.
Do not delete retained objects or modify database authority to accomplish rollback.

## Recurring deployment

After cutover, the private configuration requires a complete marketing subtree in
all promoted releases. The normal controller verifies and backs up both trees,
publishes their exact hashes and rolls both back on compatible code failure. It
also checks the configured app/marketing smoke origins match deployment settings.
Pre-cutover artifacts cannot be used as an ordinary code rollback after cutover.

The runtime compatibility gate remains unchanged. A changed hash still requires
an independent compatibility review or the migration protocol; static cutover is
not permission to rewrite that baseline. General infrastructure apply/restore
work in #86 remains separate from the compatible code path.

Startup smoke retries at most six explicit empty wake calls, with ten-second
pauses only for `WORKSPACE_STARTING` or API Gateway's exact generic 503 body.
Other failures and business operations are not included in that retry helper.

## Validation

Run root `npm test`, the ingress OpenTofu mock suite, `site/check.mjs`, hosted/demo
packaging and the demo screenshot comparison. Live completion requires the master
artifact and the operator acceptance above. A passing PR or local demo does not
establish that the public hostname cutover has occurred.

Local/operator preparation on 2026-10-15: **2,992 passed / 0 failed / 0 skipped /
0 cancelled** in the full isolated Linux ARM64 suite with PostgreSQL and Chromium;
8 ingress mock-plan cases passed. Hosted frontend, site checker and combined
packaging passed. Demo HTML and the 1280×800 Home screenshot matched the prior
reference byte-for-byte. Staged secret and portable-path checks passed.

Read-only AWS planning confirmed the six scoped ingress changes above and a
separate single-origin CORS update, with no replacement/deletion. The shared
certificate is issued. No cutover was applied: owner merge, attested master build,
private controller pin activation and live acceptance are still required.
