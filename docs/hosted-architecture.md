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
