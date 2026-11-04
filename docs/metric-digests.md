# Metric digests — issue #162

Metric digests send deterministic comparisons of a published governed metric to
its subscriber's own email address. Delivery uses the existing hosted mail
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

Only self-subscription is active. The subscriber must be an active namespace
member and pass the published metric, dataset, source, row, column and query
checks. Subscription does not add data access. Prepared datasets retain their
existing owner access; subscribing to someone else's recipe does not grant the
special published-dashboard recipe access from D-85. Legacy datasets require
the subscriber's own bound source, with dataset and source policies intersected.
Missing policies for protected datasets fail closed.

Every delivery reauthenticates the owner and recipient, recomputes under the
recipient identity, and checks source permissions, metadata revisions, current
email, membership and cancellation again at mail handoff. Digest bodies are
not retained for transport retries. User removal stops personal subscriptions,
even if other work transfers to a replacement owner; it cannot silently
subscribe the replacement's inbox.

Occurrences retain their completed-period boundary. Worker delays and retries
therefore do not advance the comparison window. Dedupe keys include tenant,
namespace, subscription, period and recipient. Repeated manual/scheduled runs
within a period reuse the occurrence. Delivery remains at least once: real
SMTP may duplicate an ambiguously accepted message; a dedupe key is not a claim
of exactly-once SMTP delivery.

## Shared destination decision still needed

The accepted IDD permits owners/admins to send to shared email lists, and also
requires that every recipient could open the metric. Existing identity records
resolve individual members only; there is no verified shared-destination or
list-membership registry. Accepting an arbitrary address or treating the list
owner as every recipient would violate that requirement.

Following the run brief's explicit stop-that-part instruction, non-owners/admins
receive `DIGEST_SHARED_FORBIDDEN`; authorized attempts receive
`DIGEST_SHARED_DESTINATION_UNRESOLVED`. The rest of the slice is implemented.
Before shared delivery can ship, decide how list membership is verified and how
recipient-specific RLS views become one shared message. No new product answer
is assumed. Slack remains deferred because no workspace Slack connection exists.
