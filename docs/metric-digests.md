# Metric digests — issue #162

Metric digests send deterministic comparisons of a published governed metric to
the subscriber's inbox or an explicit shared list of workspace members. Delivery uses the existing hosted mail
transport, durable job store, and either the single-process scheduler or
serverless due/execute/deliver events. Local and static workspaces disclose
`HOSTED_API_REQUIRED`; they do not schedule or simulate email.

## Resources and configuration

- `POST /api/v1/metrics/:metricId/subscriptions`: body
  `{ "timeColumn": "day", "dimensions": ["region"], "cadence": "weekly" }`.
  Cadence is optional and defaults to weekly. The period field must be a
  datetime column on the metric's bound dataset. Dimension names are explicit
  because governed definitions do not yet declare period/dimension roles.
- `GET /api/v1/metrics/:metricId/subscriptions`: the caller's active
  subscriptions (`items`). Tokens are excluded.
- `DELETE /api/v1/metric-subscriptions/:id`: subscriber or administrator stops
  the subscription and cancels pending work. Repeat deletion is harmless.
- `GET /api/v1/metric-subscriptions/:id/preview`: subscriber-only, fresh governed
  computation using the same query and access checks as delivery.
- The unguessable link in each message stops that one subscription without
  sign-in. Its scoped endpoint accepts GET and POST, cancels pending delivery,
  returns a no-store/no-referrer confirmation, and permits harmless replays.

API paths above are internal paths; browser ingress adds the existing `/api`
transport prefix (for example `/api/api/v1/metrics/...`).
The existing `OPENSIGHT_PUBLIC_ORIGIN` sets links. Existing SMTP/serverless mail
configuration controls delivery; no additional credentials or dependencies are
introduced. Unconfigured mail fails with the existing named transport error.
Subscriptions are `digest` jobs in `h7_jobs`; occurrences and delivery receipts
use the existing H7 tables. No new SQL migration is required. The ordinary jobs
API can inspect/run/stop them but cannot create or rewrite their subscription
specifications. Remove and recreate to change cadence or fields.

The published Metrics table has a Subscribe control. The email's metric link
opens `/#/metrics/:metricId`, including for readers, to show the current
published definition, the caller's subscriptions, a fresh comparison, and
unsubscribe controls. The local workspace reports that a hosted API is needed.

## Periods and explanations

Weekly runs are Monday at 09:00 UTC, comparing the last complete Monday-to-Monday
week against the preceding week. Daily runs are 09:00 UTC, comparing yesterday
against the day before. Windows include their start and exclude their end.
The shared query planner binds both boundaries as datetime parameters; DuckDB,
Postgres SQL and the fixture evaluator use the same strict upper comparison.

Each selected dimension is evaluated separately under the metric's published
expression. The five largest absolute group changes per dimension include the
named dimension value, prior value, current value, and signed change. Ties use
stable scalar ordering. Missing groups contribute zero for sums/counts and
linear combinations with a zero identity. Averages, extrema, and ratios retain
unavailable comparisons instead of inventing zeros. Null aggregates stay
unavailable. Group changes for non-additive metrics are explicitly labelled;
they are never represented as additive percentages or causal explanations.

A zero overall change still sends, headed **No change**. Missing comparisons
send **Comparison unavailable**, with available values. Percent change uses the
absolute prior value and is unavailable for a zero baseline. Currency/percent
formatting comes from the published governed definition. There is no AI prose,
anomaly classification, threshold alerting, or Slack delivery in this slice.

## Authorization and delivery

For personal digests, the subscriber must be an active namespace
member and pass the published metric, dataset, source, row, column and query
checks. Subscription does not add data access. Prepared datasets retain their
existing owner access; subscribing to someone else's recipe does not grant the
special published-dashboard recipe access from D-85. Legacy datasets require
the subscriber's own bound source, with dataset and source policies intersected.
Missing policies for protected datasets fail closed.

Every personal delivery reauthenticates the owner and recipient, recomputes under the
recipient identity, and checks source permissions, metadata revisions, current
email, membership and cancellation again at mail handoff. Digest bodies are
not retained for transport retries. User removal stops personal subscriptions,
even if other work transfers to a replacement owner; it cannot silently
subscribe the replacement's inbox.

Occurrences retain their completed-period boundary. Worker delays and retries
therefore do not advance the comparison window. Dedupe keys include tenant,
namespace, subscription and period, plus the recipient for personal digests or a shared-message discriminator for shared digests. Repeated manual/scheduled runs
within a period reuse the occurrence. Delivery remains at least once: real
SMTP may duplicate an ambiguously accepted message; a dedupe key is not a claim
of exactly-once SMTP delivery.

## Shared destinations

Tom confirmed the strictest-recipient rule in issue #162 comments 6617287095
(2026-11-03) and 6619715093. See [D-90](idd/D-90-shared-metric-digests.md).
Shared destinations are available now. Owners of the metric and administrators
may create them; other callers receive `DIGEST_SHARED_FORBIDDEN`.

Add `"destination": { "kind": "shared", "recipientIds": ["member-one", "member-two"] }`
to the subscription POST. Choose 1–50 unique member IDs from
`GET /api/job-recipients`. Every ID must resolve to an active identity and
membership in the caller's tenant and namespace at creation. Unknown,
non-member, duplicate and email-shaped recipients are refused with
`DIGEST_SHARED_RECIPIENT_INVALID`; arbitrary email destinations are not supported.
The response exposes `destination: { kind: "shared", recipients: [memberIds] }`,
never email addresses or the unsubscribe token. Omitting the destination retains
the existing personal request and response behavior. Historical personal jobs
without a destination discriminator remain readable.

The creator must pass the existing metric execution checks at creation. At
execution and delivery, the current member registry resolves recipients again.
Removed or inactive members, recipients who have lost metric/dataset/folder
visibility, recipients without matching row rules, and recipients denied any
measure dependency are dropped. No remaining recipient means no email and the
named failure `DIGEST_SHARED_NO_AUTHORIZED_RECIPIENTS`.

One computation uses the subscription owner's governed execution path, narrowed
by every remaining recipient's effective source and dataset policies. Row
predicates combine with AND, and denied columns combine by union. The owner's
policy remains an additional restriction even when the owner is not a recipient.
A denied dimension has no driver rows and the message says a dimension was
withheld. A denied time column, or no rows in either period after intersection,
sends **No data is visible to all recipients**, without metric values, changes,
percentages or driver rows. Measure denial removes the affected recipient before
intersection; if that removes everyone, delivery fails closed instead. Empty
row sets are detected independently of the aggregate, including COUNT's zero.
The creator-only preview resolves the same audience and computes the same result.

Both workers create one delivery per subscription and completed period, addressed
to all remaining recipients' current emails. Retries recompute; no digest body
is stored. Membership, addresses, metric/policy authorization, source status,
metadata revisions and cancellation are rechecked immediately before SMTP DATA.
A change after rendering aborts that delivery rather than handing stale data or
an obsolete recipient envelope to SMTP. Recipients removed before an attempt
are dropped normally. The token link stops the entire shared subscription.
Removing its owner stops the job under the existing ownership rules; it never
transfers the subscription to another inbox. Removing a recipient does not
stop a subscription owned by someone else.

### Current execution boundary

Source credentials and prepared recipes remain owner-bound. Shared delivery
checks each recipient's active membership, published metric visibility, any
stored dataset/folder grants, and principal/group-resolved source and dataset
RLS/CLS, including planning the measure against that recipient's effective
security. It does not execute separately as each recipient or establish that
a recipient can independently open the owner's source credentials in the app.
Prepared recipes use the existing owner preparation path, which refuses
protected source inputs; recipients still undergo membership and metadata/grant
checks. No prepared per-recipient policy is invented, and no operator identity
executes the computation. This is the supported authorization boundary, not a
claim of full per-recipient source execution.

Slack delivery remains outside this slice.
