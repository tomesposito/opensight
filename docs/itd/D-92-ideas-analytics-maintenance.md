---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-11-06
labels: [itd]
---

# D-92 — Ideas and analytics release maintenance

## CONTEXT

The authorized latest-release deployment follows the access-request release.
The registered migration now adds ideas capture and a nullable analytics
outbox delivery marker. Future object-cleanup schedules may still be pending.

## THE PROBLEM

D-89 permits only its named access-request transition. Applying it unchanged
to a different inventory would bypass its reviewed maintenance boundary.

## OPTIONS CONSIDERED

- Delay until every cleanup retention deadline has passed, then advance epochs.
- Reuse D-89 without a new contract.
- Bind a new, narrow additive transition and rehearse its preservation checks.

## REASONING

Use the third option under the user's authorization to deploy the latest
release. The source inventory is
`audit-v1-workspace-v1-ai-warnings-v1-analytics-v1-billing-v1-authoring-v1-access-requests-v1`;
the target adds `-ideas-v1`. The only schema deltas are `h8_ideas` and nullable
`analytics_events.delivered_at`. The public registered migration already checks
old row preservation and exact receipt replay. This decision authorizes no
arbitrary schema transition or cleanup-protocol change.

## IMPLICATIONS

The private owner plan binds exact releases, inventories, current/configuration
digests, epoch authority, cleanup records and schedules. Independently verify
that changed job delivery handling does not alter object-cleanup envelopes,
retention, authority or execution. Reject other pending work, claimed/near-due
cleanup, schema drift or unexpected grants. Fully stop and drain all invocations
before the registered pinned backup and transaction. Preserve both epochs and
all schedules, deadlines and attempts; only registry revision advances.

Rehearse with the actual old schema, retained access requests and analytics rows.
Require null delivery markers on migrated rows, an empty ideas table, exact
preservation, receipt retry and transactional failure checks. Both new and old
operator tables retain only operator CRUD, with no tenant or DDL grants. Verify
the current runtime after reopening and retain all captured submissions on
failure; close admission for forward reconciliation instead of restoring over
new writes. Restore is outside this exception. Signup remains dark and billing
configuration is unchanged.
