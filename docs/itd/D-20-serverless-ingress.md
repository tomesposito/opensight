---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-10
labels: [itd]
---

## Purpose

Specify the transport boundary without changing hosted identity semantics.

## Scope

CloudFront, HTTP API, canonical origin, authoring/embed routes and trusted peer.

## Out of Scope

Customer domains, authentication replacement and public operator/migration APIs.

### 🚧 ITD D-20 — How should the serverless adapter establish trusted ingress?

#### CONTEXT

`hosted-server.ts` rejects duplicate security headers, forwarded identity and
noncanonical Host/Origin. `api-client.ts` prefixes `/api` to routes that already
start `/api`; the local proxy removes one prefix. `embed-transport.ts` instead
calls `/api/embed/sessions/...` directly. CloudFront replaces Host when routing
to API Gateway, whose source IP is not necessarily the viewer's IP.

#### THE PROBLEM

How can the proxy adapter preserve existing routes and trust checks without
accepting caller-controlled routing or identity headers?

#### OPTIONS CONSIDERED

1. [WIP] Explicit CloudFront behaviors, an origin-secret Lambda authorizer and
   a strict HTTP API v2 adapter before the existing hosted boundary.
2. [WIP] Let clients call a public API Gateway endpoint with separate CORS rules.
3. [WIP] Sign origin requests at the edge and require IAM authorization at ingress.

#### REASONING

Option 1 is proposed: a DB-free authorizer can reject direct-origin requests
before waking Aurora and retain same-origin browser behavior. The shared secret
must be rotated and is a bearer credential, not proof against its compromise.
Option 2 expands origin/CORS/product scope and cannot prove CloudFront ingress.
Option 3 avoids a static origin bearer but adds an edge signing runtime, IAM
signing and deployment complexity; it remains an alternative if secret custody
cannot meet the private-state contract. Tom reviews that tradeoff before SR1.

#### IMPLICATIONS

**Routing is ordered and literal.** API Gateway has no path mapping/base prefix
and no origin-path setting; the adapter performs the one permitted rewrite.
Use the hosted build, with current browser base `/api`.

| Public path | Origin and internal path | Policy |
| --- | --- | --- |
| `/api/api/<route>` | HTTP API → `/api/<route>`; strip exactly one leading `/api` | Authoring/auth/data/operations; no cache |
| `/api/embed/sessions/<id>/<action>` | HTTP API → unchanged | Embed redeem/status/content/question/analysis/save; no cache |
| `/embed/sessions/<id>` | HTTP API → unchanged | Dynamic nonce/CSP/bootstrap shell; no cache |
| `/assets/<hashed-file>` | Private frontend S3 through OAC | GET/HEAD only; immutable build assets |
| Known app navigation paths and `/` | S3 `index.html` via viewer-request rewrite | Short/no HTML cache; explicit SPA route allowlist |
| Everything else | 404 at edge or adapter before DB access | No global S3 403/404 → index fallback |

`/api/api/host` and descendants, `/api/host`, `/healthz`, `/readyz`, `/metrics`
and migration/drain paths are absent from public routing. Operator provisioning
and maintenance use a separately IAM-authorized private invocation entrypoint
with current operator checks, audit and no anonymous URL. It does not expose
operator credentials to the browser. Block the same surfaces after rewriting.
`/api/api/api/...`, encoded separators, backslashes, dot segments, repeated
slashes and malformed escapes are rejected; never normalize twice. Preserve
existing query-string rejection for API routes. The embed bootstrap secret is
in the URL fragment, never a query string or access log.

**Ingress checks, before database construction:**

1. A CloudFront viewer-request function enforces HTTPS and the exact configured
   canonical host, rejects forbidden principal headers and duplicate singleton
   headers using its multi-value representation, and validates allowed routes.
   Deny requests to the distribution hostname as well as unknown customer hosts.
2. Reject viewer `Forwarded`, `X-Forwarded-Host`, caller `X-Forwarded-For`, and
   all reserved `X-OpenSight-Ingress-*`/viewer-address headers. CloudFront supplies
   its own viewer address using an origin request policy and overwrites the
   origin-secret and canonical-origin marker with distribution configuration.
   Headers are never an alternative identity provider.
3. Use an API origin hostname distinct from the public canonical hostname;
   disable the default execute-api endpoint and allow only the private-configured
   API custom-domain mapping. This origin is internet-addressable, not a private
   API. A DB-free HTTP API Lambda authorizer validates the secret in constant
   time on **every** API/embed route, with cache TTL zero. Missing identity sources
   deny. Direct custom-domain requests without the secret fail before API Lambda.
4. API Lambda additionally requires the expected API ID, stage, domain, route,
   authorizer context version and canonical marker; restrict its resource policy
   to the intended API/stage. No function URL. Validate method, raw path, body
   encoding and size before constructing a request. An event fixture supplied
   by an internet caller cannot choose requestContext.
5. Only after these checks, construct canonical Host from deployment configuration
   for the existing boundary. Pass the original Origin unchanged: if present it
   must exactly equal the configured HTTPS origin, with no `null`, list, userinfo,
   path or trailing slash variant. Absence is allowed for existing backend callers;
   it is not authentication. Retain existing backend-only embed issuance checks.
6. Preserve Authorization, Content-Type, Idempotency-Key, If-Match and required
   conditional headers explicitly. Reject duplicates/comma-joined singleton
   values from HTTP API v2; never split and pick a winner. Cookies do not become
   hosted identity. Reject GET/HEAD bodies and conflicting framing at ingress.

The edge must forward Authorization intentionally (CloudFront defaults can remove
it). A reviewed all-viewer-except-Host origin policy plus the required generated
viewer header may be used; the adapter discards known proxy transport headers
only after trust validation and passes a minimal request to the hosted boundary.
Origin validation is defense in depth, not CSRF/authentication proof by itself.

**Peer contract:** parse the CloudFront-generated viewer address as an IP and
port; handle bracketed IPv6, discard port, normalize equivalent IPv6 spellings
and IPv4-mapped IPv6. Missing/invalid address denies the request. Do not use a
forwarded list, caller header, Lambda socket or API Gateway edge IP. Preserve
H2's durable 15-minute buckets (global 200, peer 50, principal 10), with principal
normalization unchanged. Peer limits are abuse controls, never tenant identity.
Pre-DB wake throttling is specified separately in D-21.

**Response contract:** cache TTL/minimum TTL and error caching are zero for all
API/embed behaviors; forward auth responses with `Cache-Control: no-store`.
Keep per-session CSP `frame-ancestors`, nonce and `Referrer-Policy: no-referrer`;
no distribution-wide X-Frame-Options that blocks authorized embeds. Parent
allowlists/postMessage source checks remain H6's responsibility. Hash assets may
be public; session HTML, results and errors must never enter a shared cache.
Redact Authorization, origin secrets, body, query strings and session/bootstrap
identifiers from access/application logs. Rotate ingress keys with a bounded
two-version overlap and remove the old version after distribution propagation.

**Acceptance:** real authoring and embed path fixtures; forged host/origin/peer,
duplicate and comma headers, encoded path bypass, wrong API/stage/domain,
direct-origin and distribution-host access, missing/retired secret, cache leakage
between tenants, blocked operator routes, and Authorization forwarding. No DB
factory call on routing/ingress rejection. Edge/API behavior needs SR5 proof;
local event tests alone cannot establish deployed header provenance.

Evidence: [CloudFront custom headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html),
[viewer address](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html),
[origin policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html),
[HTTP API authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html).
