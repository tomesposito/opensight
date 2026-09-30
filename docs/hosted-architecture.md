# Hosted multi-tenant architecture — draft

Status: proposal for review, not an implementation or deployment authorization.
The hosted and embeddable/white-label direction is accepted; the recommendations,
API additions, operating targets and rollout below still need design approval.
Single-node self-hosting remains the default product.

This draft reads [SOLUTION_DESIGN.md](../SOLUTION_DESIGN.md) as the contract,
especially D13, Phase 5, Phases 3b/3c and §§12–14. It does not amend that document.
Its older §2 hosted non-goal and D11/D12 deployment assumptions need reconciliation
with the later hosted direction when this draft is reviewed. Phase 5's business
trigger has been met by that direction; scale-out implementation is not thereby
scheduled. Statements labeled **Current** describe surveyed code. **Proposed** and
**Recommendation** describe future work. `HQ-*` references identify open questions
collected in §7; proposed error codes and environment variables are not shipped.

## 1. Goal & non-goals

Provide an optional hosted service in which independent tenants can author and
consume analyses, dashboards and prepared datasets, with authenticated embedding
inside another product. Preserve QuickSight-compatible asset semantics, namespace
principals, sharing, RLS/CLS and portable definitions while adding an operational
tenant boundary. Make branding configurable without presenting security or
unsupported functionality as cosmetic choices.

The hosted option must support a safe first deployment on one node and a measured
path to multiple instances. Scaling must preserve D13's execution modes, refresh
lifecycle, named errors and provenance through the `refresh(key, load)` / `read(key)`
boundary. No customer should receive another tenant's definitions, query results,
cached rows, credentials, report contents or job history. Resource limits must
bound interference; shared infrastructure does not promise physical isolation.

**Non-goals for this draft's first rollout:** billing vendor integration, pricing
or subscription tiers (usage/entitlement hooks only); multi-region operation;
distributed analytical execution; guaranteed service levels without measurements;
anonymous embedding, embedded authoring or cross-tenant sharing by implication;
an organization hierarchy or dedicated tenant deployments without a demonstrated
need. Those product choices remain explicit questions.

The work here is documentation only. It introduces no dependency, implementation,
infrastructure, credentials or external-service operation. A future reference
deployment starts with Docker Compose; Helm is a later packaging option. Neither
is a claim that a service has been deployed. The static demo continues to say
“Needs hosted API” for unavailable functionality and “visual fidelity not measured.”

Success for a future hosted build requires tenant isolation and bypass tests on
every data path, restart and recovery tests, measured fairness under concurrent
tenants, and embed authorization/browser tests. DuckDB, Postgres and fixture/shared
post-processing paths must agree on enabled semantics. Passing local regression
tests is not proof of QuickSight API, rendering or service-level parity.

## 2. Tenancy model

### Existing primitives and limits

The survey baseline is commit `10fea78f`. These are implementation facts, not
inferences from the phase names:

| Current code | What it establishes | What it does not establish |
| --- | --- | --- |
| [security.ts](../packages/api/src/security.ts), [namespace-routes.ts](../packages/api/src/namespace-routes.ts) | `Identity = {namespaceId, userId}`; namespace-local users, groups, roles, invitations and dataset policies; namespace-prefixed routes must match the authenticated identity | A tenant lifecycle, global organization membership, built-in login or platform-operator role |
| [organization.ts](../packages/api/src/organization.ts), [sharing.ts](../packages/api/src/sharing.ts) | Flat folders, analyses/dashboard references or copies, namespace-local viewer/co-owner grants; folder and asset restrictions both apply | An organization entity or parent/child hierarchy; sharing does not grant dataset access |
| [index.ts](../packages/api/src/index.ts), [store.ts](../packages/api/src/store.ts) | Trusted startup data roots per namespace; overlap rejected; unconfigured namespaces have no fallback to default | Dynamic hosted asset storage; the sales bindings still require matching schemas |
| [prep-routes.ts](../packages/api/src/prep-routes.ts), [connector-routes.ts](../packages/api/src/connector-routes.ts) | Prepared datasets and sources resolve by namespace and owner; Blaze keys encode `[namespaceId, userId, datasetId]`; upload staging is per owner | Shared prepared datasets, durable uploads across nodes or arbitrary protected-source execution |
| [automation-store.ts](../packages/api/src/automation-store.ts), [automation-state.ts](../packages/api/src/automation-state.ts) | Cloned in-memory state, optional single-process atomic JSON replacement | Database transactions across stores/processes; legacy refresh/report/alert records have no namespace field |
| [ai-settings.ts](../packages/api/src/ai-settings.ts) | Namespace-local provider configuration and encrypted saved keys | A general tenant secret service or distributed configuration store |

Roles currently include `administrator`, `author`, `author_ai`, `reader` and
`reader_ai`. A namespace administrator can create an unused namespace through PUT;
the code copies that administrator into it but issues no credential. This is a
self-hosted registry operation, not hosted tenant onboarding. Legacy automation is
restricted to the default namespace's administrator when security is configured.
Prepared-dataset refresh scheduling is separately keyed by namespace and owner.

### Options and recommendation

| Option | Benefit | Cost or risk |
| --- | --- | --- |
| One namespace per tenant, plus a small tenant lifecycle record | Reuses every existing identity and sharing boundary; simplest isolation audit and migration | A tenant cannot yet have independently administered sub-workspaces; multi-tenant users need explicit tenant sessions |
| Organization with several member namespaces | Supports product accounts containing teams/environments; organization-wide lifecycle and configuration | New identity/membership model, delegation rules, inheritance and namespace switching; `OrganizationService` supplies none of these today |
| One shared namespace with a tenant column in application data | Fewer namespace records | Asset, principal, folder, secret and scheduler separation would need rebuilding; RLS alone cannot isolate metadata; reject for the initial design |
| Separate deployment/database per tenant | Smaller resource and failure blast radius | Provisioning, upgrades and capacity overhead; a placement option if isolation needs justify it, not the default |

**Recommendation, pending HQ-1:** introduce an opaque `tenantId` with exactly one
member namespace initially. Keep namespace IDs globally unique within a deployment,
and enforce a unique tenant-to-namespace mapping. Do not rename namespaces to
organizations or change portable QuickSight definitions. The tenant record holds
lifecycle, configuration revision, placement and limit-policy references, not data
grants. This permits a later one-to-many relationship without granting access across
namespaces now. An organization concept, if approved, is separate from folders.

The authenticated request context becomes a server-created
`{tenantId, namespaceId, userId, authorizationRevision}`. Derive `tenantId` from
the verified namespace membership; never accept it as authorization from a body,
query string, imported bundle or arbitrary header. One external identity may map
to several memberships, but each session selects and verifies exactly one. A
tenant administrator is not a platform operator. Operator provisioning credentials
must use a separate audience and permission boundary, with audited operations and
no automatic right to query tenant data.

**Proposed storage invariants:** composite unique keys and foreign keys include
tenant and namespace on assets, policies, users, groups, folders, jobs, sources,
secrets and revisions. Prepared datasets additionally retain `ownerUserId` until
sharing semantics are approved (HQ-4). Globally unique IDs do not replace scoped
lookups. Database accessors require the authenticated context; transactional tenant
row policies provide a second boundary where supported. Imported IDs/ARNs are
portable references to rebind within that context, never storage paths or grants.

### Onboarding and lifecycle

**Proposed operator API:** `POST /api/host/tenants` accepts a display name and an
initial administrator's verified external-subject reference. A required idempotency
key is scoped to the operator and payload hash. It returns `201` with
`{tenantId, namespaceId, state: "provisioning", operationId}`; replay returns the
same operation, while reuse with a different payload returns `409`.
`GET /api/host/operations/{operationId}` exposes safe progress/errors, and
`GET /api/host/tenants/{tenantId}` returns lifecycle and configuration revision.
These are OpenSight administration proposals, not QuickSight API action shapes.

1. In one metadata transaction, reserve opaque IDs, record the operation, create
   the namespace and administrator membership, set default limits and keep data
   access disabled. Do not copy fixture assets, default secrets or another
   tenant's source bindings.
2. Idempotently establish server-owned source/storage prefixes, configuration and
   invitations. Any external work is recorded durably for retry, not hidden inside
   a database transaction. Failed provisioning stays inaccessible with a safe
   error and resumable operation; compensation removes only resources it owns.
3. Verify authentication mapping, tenant constraints and required configuration,
   then atomically mark `active`. Missing optional embedding/SMTP/AI configuration
   leaves those capabilities explicitly unavailable, not the tenant falsely ready
   for them. Credentials are delivered through the identity system, never returned
   in metadata responses or committed configuration.
4. Hosted mode restricts the existing namespace-creation path to this provisioner;
   tenant administrators cannot create untracked tenants or escape quotas. Signup
   and tenant-admin delegation are product choices in HQ-2.

`POST /api/host/tenants/{tenantId}/suspend` and `/resume` are proposed audited,
idempotent transitions. Suspension increments the authorization revision, blocks
new requests and job admission, revokes sessions/embeds and cancels queued work;
in-flight work rechecks before publishing. `DELETE` starts a tracked `deleting`
operation, not immediate blind row removal. Revoke access first, then remove
artifacts, uploads, secrets and metadata under the approved retention policy.
Retain a deletion tombstone so retries/restores cannot resurrect access. Retention,
backup purge timing and tenant-admin deletion authority remain HQ-10.

## 3. Isolation guarantees

These are **proposed acceptance guarantees** for a hosted release, not claims that
today's API is ready for untrusted multi-tenant traffic. The threat model includes
authenticated tenants guessing other tenants' IDs, forging identity assertions,
replaying embeds, importing malicious references and exhausting shared resources.
It does not claim isolation from a compromised host administrator or shared runtime;
stronger process/deployment boundaries are a separate requirement (HQ-8).

### Data and authorization

**Current:** [security.ts](../packages/api/src/security.ts) resolves registered
namespace users through an injected credential verifier. The HTTP boundary rejects
forged principal headers and query bodies. The query engine's
[security resolver](../packages/query-engine/src/security.ts) binds policy to both
namespace and dataset, rejects unresolved principals, ORs matching row rules and
denies protected columns unless explicitly allowed (deny wins). The
[planner](../packages/query-engine/src/planner.ts) applies RLS before user
aggregation/calculation stages and rejects denied-column references.

There are important limits: the API policy service is bound to `sales`, and absent
stored policy produces a local `rowLevel: false` default. That is not an acceptable
implicit default for an unresolved hosted dataset. Prep accepts trusted
`unrestricted` source bindings and rejects protected ones; cached prepared queries
do not yet implement general per-reader RLS/CLS. Asset sharing is independent of
dataset permissions. Administrators bypass folder/asset restrictions, not row and
column policies.

**Required hosted ordering:**

1. Authenticate the session/service credential, resolve active tenant membership
   and required capability, then perform a scoped asset lookup. Unknown or foreign
   resources use the same not-found response, including list/search/history paths.
2. Resolve the entire dataset/source dependency graph through trusted bindings.
   Require explicit security metadata for every leaf. Reject absent policy,
   unsupported protection or cross-tenant references before opening a source,
   compiling a preview or reading an artifact.
3. For a physical relation containing multiple tenants, apply an immutable
   server-bound tenant predicate **AND** the user's RLS predicate. User row-rule
   ORs, parameters, joins, PRE_FILTER calculations and administrators cannot widen
   this outer boundary. A tenant-specific source still requires ownership and
   source authorization; a namespace name alone does not filter shared rows.
4. Resolve CLS over all dependent physical columns, including calculations,
   filters, sorts, grouping and exports. Reject denied references by name rather
   than silently removing columns. Execute SQL-mappable rules in the dialect
   layers and retain equivalent server-side semantics for cached/fixture paths.
5. Recheck authorization, policy and resource revisions before publishing results
   after asynchronous execution. A change during execution cancels publication.
   No metadata/auth availability failure permits a fallback to default or stale
   policy. Already delivered browser data cannot be recalled.

Use composite database constraints plus transaction-local tenant context, including
pooled-connection cleanup; application roles must not bypass row policies or own
tables in a way that defeats them. Test missing context and reused connections.
Apply the same checks to preview, output rows, visual queries, downloads, reports,
alerts, AI/schema access and source discovery. Never hand object-store credentials
or raw Blaze URLs to a browser.

**Prepared data gate:** initially retain owner-scoped prep and the protected-source
refusal (`PREP_SECURITY_REJECTED`). Before sharing or embedding arbitrary prepared
datasets, choose and prove either (a) tenant-only raw snapshots with per-reader
RLS/CLS before every aggregation, or (b) snapshots partitioned by a stable effective
security context, with policy/principal revision in their identity. Aggregation can
erase security columns, making later row filtering impossible. Until that is solved
for a pipeline, protected materialization is unsupported; neither a refresher's
administrator identity nor a tenant-prefixed key grants readers its data. HQ-4
covers the product scope; the isolation requirement is mandatory in either model.

§14's prep graph remains authoritative: earlier-step `from`, explicit/default
output, at most five consumers, full-stage validation and output-path
materialization rules. Namespace isolation applies to all reusable dependencies
and disconnected preview branches, not just the selected output. Preserve graph,
expansion and result budgets; importing a pipeline grants no source access.

### Auth, sessions and embedding

**Current:** `/api/session` reports the verified user; it is not a login/session
store. `SecurityOptions.authenticate` supplies verification. The shipped CLI does
not wire a hosted verifier, and SDK SSO is a stub. No hosted identity provider is
selected by this document (HQ-3).

**Proposed:** hosted startup must refuse to expose tenant routes without a verifier,
durable membership store and trusted public-origin configuration. Keep session
records or revocation/version records in authoritative metadata, scoped by tenant,
namespace, subject and audience. Verify issuer, audience, expiry and current
membership; switching tenant requires an explicit verified session exchange.
Cookie sessions, if selected, use secure, HTTP-only, host-only cookies and CSRF
protection; never share cookies across customer domains. Browser storage and cache
keys include the tenant and are cleared on switch/logout. Service credentials stay
on the embedding product's server and cannot become broad browser API credentials.

Tenant suspension, user removal, policy changes and key/config rotation must take
effect for subsequent authorized operations on every node. The safe initial model
reads authoritative revisions on each request; any later caching requires a
specified revocation bound and tests. Signing keys include key IDs and tenant-bound
claims; a token valid for one tenant/origin/audience must fail everywhere else.

### Compute, Blaze and scheduler fairness

**Current:** Blaze has global byte/row/cell caps, LRU eviction and one intake
reservation per process for refresh/direct materialization. Keys distinguish
namespace and owner, but one tenant can consume capacity or force another's
eviction. Accounted bytes are not a process RSS limit. Upload staging/queues and
DuckDB working memory add separate costs. These are bounds, not fair scheduling.

**Proposed:** admission requires both a tenant budget and a node budget. Bound
concurrent queries, refreshes, source connections, uploads, queued jobs, decoded
snapshot bytes, artifact/disk bytes, result bytes and execution time. Start with
equal tenant admission shares and bounded per-tenant queues; weights/tier values
remain HQ-8. Reserve refresh capacity so a query burst cannot starve freshness,
and retain global headroom. Evict within a tenant's allotment before borrowing
unused shared capacity. Decline work explicitly (`TENANT_LIMIT_EXCEEDED`, proposed
429 with retry guidance); never truncate a dataset to fit. Stop/cancel execution
when budgets expire, with a safe diagnostic.

Worker processes with memory/CPU limits are the recommended next boundary when
untrusted analytical work can block the API event loop or cause process-wide
failure. Fair queues alone do not bound native memory, garbage-collection pauses,
disk pressure or shared source load. Before admitting unrelated hosted tenants,
measure contention and cancellation; reject workloads that cannot be bounded in
the chosen execution mode. Dedicated placement remains optional and unpriced.

Every job carries tenant, namespace, initiating/owning principal, target revision,
run ID and due occurrence. Reauthorize at execution and before output delivery;
never execute as an all-tenant administrator. Tenant suspension/deletion cancels
admission and publication. Scope recipients, histories, alert state and usage
records as carefully as data. Legacy automation remains default-only until its
resources and rendering path are migrated and tested. Do not merely add a
namespace field to the current unscoped snapshot service.

The hard problems are revocation racing with long queries, security through
aggregated caches, tenant restore in shared metadata, native-memory fairness,
lost invalidations, and duplicate externally visible job effects after crashes.
The release gates in §8 require failure tests for these; they are not solved by
adding tenant IDs or a distributed lock alone.

## 4. Embedding & white-label API surface

### Shipped Phase 3c contract

The [embedding service](../packages/api/src/embedding.ts),
[SDK](../packages/embedding-sdk/src/index.ts) and
[renderer](../packages/web/src/embed-main.tsx) implement the following:

| Surface | Current behavior |
| --- | --- |
| `POST /dashboards/{id}/embed-url` (also `/api/dashboards/...`) | Authenticated caller only; body `{parentOrigin, visualId?, expiresInSeconds?}`; TTL 60–900 whole seconds, default 300; response `{url, expiresAt}` |
| `GET /embed/dashboards/{id}?token=...` | HMAC-SHA256 signed bearer URL; namespace/user, dashboard/optional visual, exact parent origin, issue/expiry times and nonce; token is not encrypted and is not a general API credential |
| Server configuration | One trusted public origin and parent-origin allowlist for the process; signing secret from `OPENSIGHT_EMBED_SECRET`; no caller-selected host or client signer |
| Authorization | Current membership and folder/asset grants rechecked on load, viewer query security applied, expiry and asset grants rechecked after asynchronous rendering |
| Browser boundary | Credentialed CORS only for issuance; exact origins, CSP `frame-ancestors`, script nonce, `no-store`, `no-referrer`; URL removed from frame history after load |
| SDK | `createEmbeddingClient`, `generateEmbedUrl`, `embedDashboard`, `embedVisual`; `refresh()` and `destroy()`; ready/expired/error callbacks with origin/window checks |
| Authentication hook | `getAuthorization` plus `onAuthenticationRequired`; OIDC/SAML/exchange are not implemented; `ssoNotConfigured` is an explicit stub |

This renders a snapshot of supported visuals using the namespace's sales binding.
It has no persistent interactive data session; refresh generates and loads a new
URL. Expiry replaces the view, but cannot erase data already received. The nonce
does not make a v1 URL single-use. Current SDK validation requires the returned
origin to equal `apiOrigin` and the v1 token shape; custom origins or a new token
format need an explicit SDK upgrade. The iframe title includes OpenSight and the
renderer has fixed presentation. There is no tenant branding/custom-domain API.
See [Phase 3c documentation](folders-sharing-embedding.md) for existing limits.

### Proposed tenant configuration

All additions below are OpenSight-local versioned contracts, **not implemented**.
Continue the plain `node:http` resource/validation patterns. Preserve v1 issuance
for its current semantics; do not silently turn its token into a session token.
QuickSight compatibility applies to asset/security meaning, but exact AWS embed
actions, lifetimes and options require the pinned-contract evidence described in
SOLUTION_DESIGN §3.2 (HQ-12).

| Proposed endpoint | Authority and contract |
| --- | --- |
| `GET /api/embedding/config` | Tenant administrator; returns effective non-secret config, revision and supported capabilities |
| `PUT /api/embedding/config` | Tenant administrator within operator policy; `If-Match` revision required; replaces validated config, increments revision and revokes sessions when security settings change |
| `POST /api/embedding/sessions` | Registered user, or explicitly authorized server credential acting through a verified subject mapping; creates a bounded embed grant |
| `DELETE /api/embedding/sessions/{id}` | Issuer or tenant administrator in the same tenant; revokes grant, redemption and future requests |
| `POST /api/embedding/sessions/{id}/renew` | Reauthenticate original authority and reauthorize the subject and asset; issue fresh bootstrap URL; an expired embed token alone cannot renew |
| `POST /api/embedding/domains` | Tenant administrator if operator permits; creates a pending hostname claim and verification challenge, no active routing |
| `POST /api/embedding/domains/{id}/verify` | Verifies domain control and certificate readiness; activation is an audited state transition |
| `GET /api/embedding/domains`, `DELETE /api/embedding/domains/{id}` | Tenant administrator; inspect status or revoke routing and affected sessions |

Proposed configuration fields are `enabled`, `allowedParentOrigins`,
`embedOriginId`, `maxSessionSeconds`, `appearance` and `features`. A server-owned
registry resolves `embedOriginId`; a body cannot supply an arbitrary signing or
redirect origin. `appearance` can reference a tenant-owned theme and validated
logo/favicon assets, plus bounded text such as product name and iframe title.
Use approved color/font/layout tokens, not executable HTML, arbitrary CSS or
unrestricted external asset URLs. Theme resources retain their existing portable
meaning; service chrome/branding metadata lives separately. Light/dark behavior,
which chrome can be removed and whether branding removal is available to everyone
are HQ-5. Required legal notices are not a UI theme switch.

`features` describes supported capabilities such as parameter controls, filtering
or export; it cannot confer authorization. Unsupported flags fail with proposed
`EMBED_FEATURE_UNSUPPORTED` (422), not a simulated control. Embedded authoring,
anonymous access, exports and saved reader state require explicit product choices
(HQ-6). Configuration edits use optimistic concurrency (`412` on revision conflict),
reject unknown fields and enforce operator caps. A tenant cannot widen its origin
list beyond operator policy or set an unbounded session lifetime. Exact caps and
default session lifetime remain HQ-7; the existing v1 TTL is unchanged.

### Proposed session issuance and browser flow

The session request contains `{dashboardId, visualId?, parentOrigin,
requestedDurationSeconds?, initialParameters?}`. The server resolves tenant and
user from authentication. A product backend integration may additionally submit
an external-subject reference **only** when its server credential is allowed to
use a preconfigured subject-to-membership mapping. No request may assert groups,
roles, raw policy or an arbitrary target namespace. Unresolved subjects fail closed;
no implicit just-in-time user creation is assumed (HQ-3).

The response is proposed as `{sessionId, url, bootstrapExpiresAt, sessionExpiresAt,
configRevision, capabilities}`. Bind the signed bootstrap to tenant, namespace,
subject, dashboard/version or visual scope, exact parent and embed origins,
audience, key ID, revision, nonce and expiry. A durable atomic redemption record
makes the new bootstrap single-use; concurrent replay fails. Authorize again on
redemption, renewal and every data request. Parameters are typed interaction
values, not tenant predicates, and unsupported interactions fail explicitly.

After redemption, deliver only an embed-scoped credential to the frame, held in
memory for API authorization. Remove the bootstrap URL from history and prohibit
logging its query string at every proxy hop. Keep session state/revocation in
metadata, not coordination pub/sub. This proposed bearer flow avoids requiring
third-party cookies; cookie-based alternatives and browser coverage need HQ-7's
decision. Do not transfer the frame credential to the parent through `postMessage`.
The signing and encryption keys always remain server-side.

The SDK extension adds a versioned session transport, explicit allowed embed
origins from trusted application configuration, and `sessionExpired`,
`authorizationRevoked` and structured error events. Validate both message origin
and source window and associate events with the active session/refresh generation.
Never disable origin checks to support custom domains. The renderer polls or
reauthorizes on interaction according to the approved revocation bound; a hosted
status loss makes protected content unavailable. Immediate recall of a captured
snapshot is impossible and must not be promised.

Proposed safe errors include `EMBEDDING_NOT_CONFIGURED` (existing, 503),
`EMBED_ORIGIN_DENIED` (existing, 403), `INVALID_EMBED_TOKEN` (existing, 401),
`EMBED_SESSION_EXPIRED` / `EMBED_SESSION_REVOKED` (new, 401),
`EMBED_SUBJECT_UNRESOLVED` (new, 403), and `EMBED_DOMAIN_UNVERIFIED` (new, 409).
Responses must not reveal another tenant's membership or domain owner. Unrelated
existing API error envelopes are not silently standardized by this proposal.

### Custom domains and white-label gaps

Treat product parent origins and OpenSight embed origins as distinct allowlists.
A verified customer hostname may route only to its registered tenant. Check the
trusted host mapping against authenticated tenant and token audience; never choose
tenant identity from `Host` alone. Enforce globally unique active/pending hostname
claims, HTTPS certificate lifecycle, exact parent origins, trusted proxy headers
and safe handling of unknown hosts. Domain removal/reassignment invalidates old
sessions and certificates/routing; stale DNS must not permit takeover. Ownership
verification, certificate automation, renewal failure and quotas need a reviewed
operational design before enabling domains (HQ-9).

White-label completeness also includes loading/empty/error/expiry pages,
accessibility titles, help links, favicon, emails and exports if those surfaces
are offered. Branding must not hide data freshness, permission failures or
unsupported functionality. Theme preview and screenshot tests should cover these
states. Which surfaces are in the first release is HQ-5, not inferred from the
phrase “like QuickSight.”
