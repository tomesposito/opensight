# Phase 5 — release requests and production status

Contract: [D-78](itd/D-78-release-requests.md). Related issue: #86.

The public build publishes an attested release. It does not deploy. A remote
developer can request that exact release without AWS access; an independent
operator approves it and dispatches the existing private OIDC controller.

## Remote developer

After the master build has published `build-<full-source-sha>`, run the public
**Request a production release** workflow from master with that source SHA.
Its output gives a GitHub deployment request ID and exact manifest digest.
It needs no AWS credentials or private-repository access. The equivalent CLI is:

```sh
export OPENSIGHT_PUBLIC_REPOSITORY=owner/repository
node ops/serverless/release-requests.mjs request "$RELEASE_SOURCE"
node ops/serverless/release-requests.mjs list
```

Use the pinned GitHub CLI documented in the workflow, authenticated to GitHub.
`OPENSIGHT_GH_BINARY` selects its local executable if needed. The request tool
downloads the manifest/provenance, verifies the trusted master build, and creates
a deployment request. It never checks out or executes the requested source.
No request can override compatibility, write an AWS approval or dispatch private
CI. Public status records are informational and cannot authorize deployment.

GitHub exposes the records in the repository's deployment history and through
its [deployment API](https://docs.github.com/en/rest/deployments/deployments).
`list` prints the newest twenty requests and the most recent successful AWS
observation. That observation distinguishes the runtime source from marketing
source and includes its timestamp. It is not a continuously refreshed health
signal. The `production-observed` environment records observation; `production`
holds requests and their outcome.

| Display/API state | Meaning |
| --- | --- |
| Build release exists | Tested artifacts published; no promotion implied |
| Requested / `pending` | Exact artifact requested; awaiting independent review |
| Approved / `queued` | AWS approval read back; expires after four hours |
| Deploying / `in_progress` | Private dispatch attempted; outcome still unverified |
| Deployed / `success` | Matching private run passed and AWS state matched |
| Failed / `failure` | Private run did not succeed; operator must reconcile |
| Blocked / `error` | Compatibility or state review is required |

Historical queued/success states are dated events, not perpetual approval or
health promises. Only the private AWS approval and current release authorize the
controller. A changed schema/authority compatibility digest needs a separately
reviewed maintenance activation; merging or retrying a request cannot bypass it.

## Independent AWS operator

Keep the existing owner-only `ci-config.json` outside both repositories. Set
`OPENSIGHT_OPERATOR_DIR` to that directory and use independent local AWS access.
The scripts reject the CI read/deploy role as the approving operator. Neither
the request workflow nor private controller receives a new IAM permission.

```sh
node ops/serverless/release-requests.mjs approve "$REQUEST_ID"
node ops/serverless/release-requests.mjs dispatch "$REQUEST_ID"
node ops/serverless/release-requests.mjs reconcile "$REQUEST_ID"
node ops/serverless/release-requests.mjs observe
```

1. Review the source and semantic compatibility before `approve`. It repeats
   attestation/digest verification, checks private configuration against AWS,
   refuses an active operation or incompatible baseline, and writes the existing
   exact-source/manifest/current/configuration approval. It reads the approval
   back before saving a private receipt and reporting queued.
2. `dispatch` revalidates all of those bindings and the unexpired approval. The
   private dispatch wrapper must support the request correlation input/run name
   and still pin the configured immutable controller. Save a single-use private
   intent **before** the network call. It contains no authority to approve itself.
3. `reconcile` finds exactly one original private run with the saved token, event,
   branch and workflow. It refuses duplicates/reruns. Pending or unconfirmed
   dispatch remains pending; it never retries dispatch. A failed/cancelled run is
   reported as failure. Private URLs, logs and resource configuration stay private.
4. A successful run is insufficient by itself. Read back the current release
   twice around inspection; require an unchanged ETag, exact requested source and
   manifest, all four images/configuration fingerprints, current request alias,
   active functions with positive bounded concurrency, both expected enabled
   mappings, and no active operation. Only then publish observation and success.
5. `observe` independently records the current runtime/marketing source and date,
   after the same AWS inspection. It makes no application request or SQL query,
   sends no mail and does not wake Aurora. Its only write is the sanitized GitHub
   deployment record. API failures never become a successful observation.

All commands are bounded, one-shot invocations. Call `reconcile` again when a run
finishes; no permanent poller or background service is required. Public status
publication failure does not undo an approval/deployment or permit redispatch.
The existing private controller still owns the actual lock, watchdog, drain,
promotion, smoke and rollback protocol.

## Recovery and activation

The operator bridge serializes local commands with an exclusive
`release-requests.lock`. A hard crash deliberately leaves it behind. Confirm the
recorded process has stopped, inspect the private request receipt and actual
private run/AWS state, then remove that local lock explicitly. Do not delete an
attempted request receipt to retry. An uncertain dispatch must be reconciled;
if there truly was no dispatch, a new independently reviewed request is required.
The AWS operation lock is separate and must never be removed by this procedure.

The companion private change only adds a correlation input and run name to the
dispatch wrapper. It does not change the reusable controller, its OIDC pin or any
AWS policy. Both source changes require the owner's normal master merge. Once
merged, the public workflow and correlated dispatch are usable immediately;
there is no infrastructure apply for this slice.

## Verification

The live operator exercised manifest/provenance verification and public request
creation for the already published master release. Its compatibility mismatch
correctly reported blocked before any AWS approval or runtime promotion. A live
AWS observation verified the existing deployment and published separate runtime
and marketing SHAs. No runtime, database, DNS or IAM change was made.

Local acceptance covers untrusted requests, wrong digests/refs/repositories,
expired or stale approvals, compatibility rejection, pre-dispatch receipts,
response loss, public-status failure, duplicate runs, reruns, failed/cancelled
runs, mismatched/unknown production state and sanitized publication. A CLI
boundary test exercises S3's streaming outfile/required flags and Lambda reads.
The demo was rebuilt; its HTML and Home screenshot match the prior reference
byte for byte. No product UI changed.

Full root `npm test` in isolated Linux ARM64 with real PostgreSQL and Chromium:
**3,008 passed / 0 failed / 0 skipped / 0 cancelled**. The sixteen new request
tests also passed independently. Both workflow YAML files parsed; staged secret
and portable-path checks passed. No new dependency was added.

The owner merge and an independently approved **compatible** release are still
needed to exercise the new correlated private dispatch end to end. Existing
compatible promotion remains live. Generic saved-plan/migration/restore execution
and #85's report/alert delivery acceptance are not completed by this slice.
