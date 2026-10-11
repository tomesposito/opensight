---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-11
labels: [itd]
---

## Purpose

Activate the authorized two-tester deployment using the resources already validated.

## Scope

Initial platform promotion, private identity bootstrap and first admission.
[SR4b1](../phase5-sr4b1-initial-activation.md) defines the implementation contract.

## Out of Scope

General production migrations/rollback, restore, recurring-release CI and public
self-service signup. D-25 remains a separate proposal for those capabilities.

### ✅ ITD D-33 — How should the first test workspace be activated?

#### CONTEXT

The owner has asked the agent to complete deployment. Durable storage and client
reconnect behavior are implemented. The private Aurora/Lambda network and public
ingress have separate state ownership. The existing database is frozen and has
no application testers. Recreating it would discard useful validation history.

#### THE PROBLEM

Create real tester access and activate durable workers without exposing setup
operations, fabricating invitation delivery, or turning initial activation into
an unsafe general maintenance bypass.

#### OPTIONS CONSIDERED

1. ✅ Promote the existing inventory, privately bootstrap two isolated tester
   workspaces and use a one-time, schema-checked admission transition.
2. Rebuild a separate deployment and discard the validation resources.
3. Expose public setup or reuse invitation delivery with synthetic success.

#### REASONING

Option 1 keeps the measured network/database and its protected state. Private
IAM plus current operator authorization, exact receipts and epoch-one guards
make the initial action reviewable and retryable. Existing hosted password/TOTP
login still authenticates testers; no request runtime gains setup authority.
Two workspaces make cross-tenant acceptance concrete. Credentials are generated
and delivered through an owner-only local file, with no onboarding email.

Separate work/recovery consumers use AWS's minimum supported maximum-concurrency
setting of two, with matching reserved concurrency. This prevents avoidable
queue throttling without paying for provisioned concurrency. SQL budgets still
bound actual execution. Option 2 adds cost and work without improving this test.
Option 3 weakens the trust boundary or misrepresents email delivery.

#### IMPLICATIONS

- The pilot tag disables legacy destructive validation cleanup based on actual
  AWS state, even when local files are stale. Data/state resources stay protected.
- Initial bootstrap requires an empty, owned, frozen deployment. Exact retries
  do not reset passwords/TOTP. Populated/foreign schemas and retired keys deny.
- Initial activation preserves epoch one and records its use. It cannot reopen
  later maintenance, advance epochs or claim to implement D-25 recovery.
- API/worker secrets and object permissions remain separate from private DDL
  authority; business-object cleanup remains the durable SQL worker's job.
- Real HTTPS authentication/upload/query/isolation acceptance and return to zero
  ACU precede apex DNS publication. A Connect screen alone is not live. The
  greater-than-24-hour pause/resume check is follow-up work.
- Public code includes only reusable contracts and synthetic fixtures. All
  deployed identities, addresses, credentials, plans and receipts stay private.

#### Pilot concurrency correction — 2026-10-11

A real three-request burst against the frozen adapter reproduced an origin 503.
CloudWatch recorded throttles for both the two-slot authorizer and the one-slot
request function. The web catalog already issues a two-request parallel read;
the two testers may overlap. Select four reserved slots at both HTTP boundaries,
with no provisioned environments. Keep the two-slot worker caps, existing API/WAF
rate limits and shared SQL admission budgets. Reserved concurrency adds no idle
charge; simultaneous accepted executions still incur normal usage charges. This
corrects the validation profile's overly restrictive cap before pilot admission.

Source: [AWS reserved concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html).

#### Initial SQL role preparation — 2026-10-11

Pilot concurrency increases the possible runtime SQL connections beyond the
validation role limit of four. The private initial migration sets eight per role,
matching the maximum request/work/recovery invocations without adding idle
connections. Existing invocation cleanup and SQL budgets remain authoritative.

A PostgreSQL owner without BYPASSRLS is still filtered by FORCE RLS. Empty-database
checks must never mistake filtered rows for absence. Initial administration
therefore verifies ownership, grants bypass only to its existing private owner
when needed, and proves global emptiness within the same rollback-safe transaction.
Runtime roles gain neither schema ownership nor maintenance authority; tenant RLS
stays forced. This is limited to the dedicated deployment's first preparation and
must be verified on Aurora before admission. An engine refusing the owner-role
change fails closed rather than disabling row policies.

Sources: [Aurora administrative role](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html),
[PostgreSQL row security](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

#### Launch timing correction — 2026-10-11

The owner directed progress toward activation rather than waiting for a full
24-hour idle interval. CloudWatch had already recorded over 19 hours at zero
ACU, and a shorter sleep/wake cycle had passed. Preserve those measured facts
and verify a wake during activation. Defer the greater-than-24-hour measurement
to a later quiet period; it remains unmeasured until actually completed. Real
application acceptance, isolation and return to zero ACU remain launch gates.
