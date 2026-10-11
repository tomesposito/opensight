# Phase 5 SR4a — initial public ingress

This freezes the first public entry point for the already-authorized, minimal
serverless test deployment. It adds no database connections, migration, tenant
creation, new application feature or background wake-up task. Application
activation, durable consumers and the release workflow follow separately. A
working static entry point is not acceptance of the deployment goal.

## Ownership and cost

Keep the existing validation root as owner of its database, VPC, functions,
artifact bucket, secrets and state. Add an `ops/serverless/ingress` OpenTofu root
with its own key in the same encrypted, versioned, locked remote backend. It owns
only the public ingress resources, frontend bucket and database-free authorizer.
Consume explicit private references to the existing request function and a
published numeric function version. Never import or replace the existing database.
Use the already pinned OpenTofu/provider versions and lockfile. No new application
dependency is needed.

Choose CloudFront's Free flat-rate plan and associate its distribution, global
WAF ACL and the existing Route 53 zone. CloudFront Functions, managed policies,
OAC and four behaviors fit the documented Free feature set. Manage the subscription
with a CloudFormation stack through OpenTofu if the pinned provider has no native
resource. Require ACTIVE/FREE before public DNS cutover; do not auto-approve a
paid tier. A rejected feature combination requires a reviewed correction within
the frozen security contract, not an unannounced downgrade or paid upgrade.

The plan does not cover Lambda, API Gateway, Aurora, SQS, Scheduler, Secrets
Manager, KMS or all storage charges. Keep existing database min/max 0/2 ACU,
five-minute pause, no NAT/public database and existing budget alerts. This slice
adds one small Secrets Manager secret and three-day operational logs. Preserve
all data/state buckets with prevent-destroy; frontend versions and current/prior
release assets are retained rather than force-deleted. No health poll is added.

## HTTPS, DNS and static delivery

All account IDs, domain/zone names, function references, addresses, recipient
settings, state locations and credentials are private inputs. Examples use only
reserved names. Route 53's existing zone is read by its explicit ID; do not create
or replace a hosted zone. Request DNS-validated ACM certificates in us-east-1 for
the site's exact apex and a separate API origin subdomain. Retain unrelated DNS
records. Create only certificate validation, API-origin aliases and, when
`publish_site=true`, the site's A/AAAA aliases. The default is false.

Use one CloudFront distribution with a private S3 REST origin and OAC, and an
HTTPS API Gateway custom-domain origin. Default HTML uses managed CachingDisabled;
`/assets/*` uses managed CachingOptimized. `/api/*` and `/embed/sessions/*` use
CachingDisabled and managed AllViewerExceptHostHeader. Never cache API responses,
embed shells, authentication or errors. Use TLS 1.2 or later, viewer HTTPS policy,
no origin failover and no API error-to-HTML rewrite. Preserve the embed's own
CSP/frame-ancestors instead of applying X-Frame-Options DENY to embedded responses.

The frontend bucket blocks public access, uses ownership enforcement, versioning,
AES256 encryption and TLS-only policy. CloudFront alone may read its frontend
prefix. Upload hashed assets before replacing index.html; HTML has no-store and
assets are immutable. Keep prior hashed assets usable by already-open clients.
Upload only reviewed manifest-listed build files; reject links, unexpected paths
and changing bytes under an existing asset key.

## Viewer identity and origin boundary

An API-behavior CloudFront Function validates the canonical viewer host, literal
path, query rejection, singleton headers, origin and forbidden principal/proxy
headers using the existing SR1 boundary semantics. CloudFront's behavior enforces
HTTPS. Reject viewer-supplied ingress headers. In this explicitly selected
viewer-function deployment, discard `CloudFront-Viewer-Address` before shared
viewer validation: the managed policy can supply it before the function runs.
Whether viewer-supplied or platform-added, that header has no identity authority.
The shared unselected viewer validator continues to reject it. Other principal,
proxy and private ingress headers retain their existing rejection semantics.
The function has no secret and performs no network request. On accepted requests
it sets `x-opensight-ingress-peer` from the platform's `event.viewer.ip` only.
Never derive it from X-Forwarded-For or another viewer header. Do not log requests.

Select this provenance with `OPENSIGHT_INGRESS_PEER=viewer-function` in both
origin authorizer and request runtime. The default, unset mode retains the
existing CloudFront-Viewer-Address contract. Reject other nonempty modes. The
new peer header is a singleton, denied at public/local boundaries, and admitted
only in the explicitly selected AWS mode. Validate and normalize exact IPv4/IPv6,
including IPv4-mapped IPv6, before it reaches authentication rate limits. Missing,
joined, malformed or mismatched provenance fails before SQL. Managed policy header
behavior must be demonstrated through the live edge; never assume an arbitrary
viewer header is trustworthy.

CloudFront origin configuration supplies the existing private ingress key ID,
secret and canonical-origin headers. A dedicated secret contains only the ingress
key set. The authorizer reads AWSCURRENT per invocation; it cannot read database,
operator, tenant or SMTP secrets, and has no VPC/database access. Its HTTPS client
uses IPv4 from the Lambda public network, bounded requests, no SDK retry and
invocation-owned socket cleanup. Runtime secret handling otherwise remains
unchanged. Unknown configuration/service failure denies authorization.

Use the image's separate database-free `aws-authorizer.handler`, ARM64, 256 MiB,
ten-second timeout, concurrency two and no function URL. Test actual memory/cold
start before increasing resources. Grant only the exact secret and log stream
permissions. API Gateway authorizer caching is disabled. Permit invocation only
from this API's authorizer ARN. A request-function `live` alias selects the exact
published version; this root owns that alias, not the function's code/configuration.
API permission targets only that alias and the exact API.

The origin is an HTTP API with its default execute-api endpoint disabled, TLS
custom-domain mapping and payload format 2.0. Keep `$default` for the SR1 literal
route adapter and add exactly `POST /api/api/startup` for independent throttling.
`OPENSIGHT_INGRESS_STARTUP_ROUTE=separate` admits that route key only for the exact
startup method/path in authorizer and request adapter; unset retains the original
single-route contract. Wrong route/context/domain/API/stage remains denied.

Configure default stage throttling at 5 requests/second, burst 10, and startup at
0.1/second, burst 2. WAF adds one unscoped IP rate rule at 600 requests/5
minutes, including static requests. Do not use URI scope-down statements, regex,
header matching or custom aggregation in this initial Free profile. The global
startup control is the tighter API Gateway token bucket: a token every ten
seconds after the two-request burst. Concurrent testers can receive 429 and use
the existing bounded startup retry. This is not a five-minute per-IP startup
counter. These are abuse controls, not a
hard account spending cap. No tester-IP allowlist is silently imposed. Disable
sampled request bodies/logs; retain service counters and safe request outcome
metadata only. HTTP origin bypass, forged identity, alternate paths and duplicate
headers must be refused before application/database work.

## Private operator and state custody

Use a private 0700 operator directory outside the public checkout, files 0600 and
account-bound inputs. The origin shared secret is an explicitly sensitive input:
CloudFront necessarily places it in its configuration and the encrypted private
plan/state. Do not put it in source, GitHub variables, public artifacts or command
arguments. Read its source secret into a private file/in-memory environment and
suppress raw plan/service output. The database-free authorizer secret must match
the request runtime's accepted ingress keys before activation. Rotation is a
separate coordinated current/next-key operation; do not retire a key implicitly.

Plan and apply separately under the backend lock. Bind the saved plan digest to
source/configuration, expected account and state lineage/serial; reject changed,
stale or destructive plans. Routine plans deny data/state bucket, key, database
or existing function replacement/deletion. Authorizer/code release inputs require
an immutable owned ECR digest and published function version, never latest tags.
The operator checks ACTIVE/FREE and exact resource association before setting
publish_site. It never sends a message/email or changes a database in this slice.

AWS rejected the original WAF rules and a subsequent IP-only configuration that
retained URI scope-down statements. The exact unsupported statement is not
reported by the subscription API. Use the documented plain IP-rate feature and
move strict startup admission to API Gateway. Removing scope-down broadens the
600-request ceiling to all traffic; tightening startup from 0.5 to 0.1/second
reduces global application wake admission to approximately 30 per five minutes
plus the two-token burst. Gateway-rejected traffic can still incur API charges.
Confirm actual Free eligibility rather than inferring it from mock tests.

A failed subscription-only CloudFormation stack may be removed for retry only
when it is owned by this deployment, is ROLLBACK_COMPLETE, contains no resource
other than the subscription, and no subscription currently associates the
distribution or WAF. Record the inspection privately before deleting that empty
failed stack. Never delete a live subscription, distribution, ACL, bucket or DNS
record through this recovery step. Refresh/replan against retained resources;
the normal destructive-plan prohibition remains in force.

## Acceptance and sequencing

Offline tests cover viewer forgery/duplicate headers, IPv4/IPv6 provenance,
separate-startup route confusion, authorizer failures/cleanup and Terraform
ownership/security/cost constraints. Run the root test suite and rebuild demo.
There is no new product UI in this slice.

Cloud steps are separately authorized operator execution: inspect account/zone,
prepare private inputs, build/test and scan immutable artifacts, publish a frozen
request version, review/apply the saved ingress plan, validate certificates and
verify the Free subscription. Exercise CloudFront request metadata with the
DB-free authorizer and negative origin requests; preserve the ongoing Aurora
pause experiment. Keep publish_site false until the activation slice proves
startup, tester authentication, upload/ingestion/query and isolation through this
same endpoint. No maintenance/static shell is called a completed deployment.
