# Initial public ingress operator

This root consumes the existing deployment; it does not own or migrate its
database, VPC or request function. See the frozen contract in
[`docs/phase5-sr4a-public-ingress.md`](../../../docs/phase5-sr4a-public-ingress.md).

Use the same private `OPENSIGHT_OPERATOR_DIR` as the validation operator. It must
be an owner-only directory outside the checkout. AWS CLI credentials remain in
the normal local credential chain. The CLI must support `pricing-plan-manager`.
All service responses, plans and state stay in that private directory.

Prepare `ingress-release.json` there with these fields:

- `image_uri`: the reviewed immutable image in the deployment's owned ECR repo.
- `request_function_version`: a published numeric version of its request function.
- `request_code_sha256`: the exact AWS code digest of that published version.
- `frontend_directory`: the canonical absolute path of the reviewed browser build.
- `frontend_manifest_sha256`: SHA-256 of that build's `manifest.json`.

The image must contain `packages/api/dist/aws-authorizer.js`. The first request
version remains frozen; activation follows separately. The operator copies only
the current ingress key from the existing operator secret to private Terraform
inputs. It creates a separate secret for the database-free authorizer.

Run from a clean, committed checkout:

```sh
node ops/serverless/ingress-operator.mjs prepare
node ops/serverless/ingress-operator.mjs plan
# Review the private ingress.plan.json and the printed digest.
node ops/serverless/ingress-operator.mjs apply REVIEWED_PLAN_SHA256
node ops/serverless/ingress-operator.mjs verify
node ops/serverless/ingress-operator.mjs frontend
```

Plan receipts expire after one hour and bind source, private configuration,
account, saved plan bytes and remote state lineage/serial/version. Apply denies
replacement/deletion and unowned resource types. Terraform also rejects stale
state under the backend lock. Do not use direct apply to bypass these checks.
No logs or raw plans belong in GitHub artifacts. Local heuristic secret scanners
may match Terraform attributes named `secret_string` or secret ARN references;
inspect their values rather than treating an attribute name as a credential.

Frontend transfer validates every manifest entry, rejects links/extra files and
compares existing immutable asset bytes before any writes. Conditional writes
reject concurrent changes. Assets precede HTML; `index.html` is last. Old assets
are retained. The manifest itself is not uploaded.

`prepare` leaves public site DNS disabled. An activation acceptance record must
prove startup, tester authentication, upload, ingestion, query and isolation
against the candidate endpoint. Store it as owner-only `ingress-acceptance.json`:
`version: 1`, `account`, `deployment`, `publicOrigin`, `imageUri`, `requestVersion`,
`manifestSha256`, `completedAt` (epoch milliseconds), and `checks` with all six
named boolean fields (`testerAuthentication` is the authentication field).
Acceptance expires after one hour and must match the release exactly.

After those live checks, `cutover` selects DNS publication in private inputs.
Run a new `plan`, review its digest and `apply` it. Both planning and applying
cutover read the actual subscription and require ACTIVE/FREE, the exact
distribution/WAF/zone association and no scheduled plan change. No command
automatically buys a paid plan or treats a static shell as live acceptance.
