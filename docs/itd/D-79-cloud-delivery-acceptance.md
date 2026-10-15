---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-15
labels: [itd]
---

### ✅ ITD D-79 — How do we complete cloud delivery and recovery acceptance?

#### CONTEXT

SR3 is deployed. Live upload/ingestion/query and scheduled refresh passed. Report,
alert, failure/recovery and replay IAM acceptance remain open in #85. The operator
is explicitly authorized to finish both implementation and cloud work.

#### THE PROBLEM

Prove the actual delivery protocol without exposing maintenance through HTTP,
granting replay callers migration power or sending mail to unapproved recipients.

#### OPTIONS CONSIDERED

1. Broaden all public routes and invoke the general administration function.
2. ✅ Dedicated replay-only handler and a bounded private synthetic cloud harness.
3. Treat local fake-broker/SMTP tests as sufficient cloud evidence.

#### REASONING

Option 2 preserves the existing route and IAM boundaries. Reports currently use
the legacy dataset/dashboard binding; merely enabling v1 routes would not prove
that path. A private fixture can create the exact synthetic assets and exercise
the real renderer, coordinator, queues, database and configured SMTP transport.

#### IMPLICATIONS

- Replay accepts exactly `{version:1,event,acceptAmbiguous}`. Validate the full
  identifier-only envelope before opening credentials or SQL. Reject recovery
  events, arbitrary commands/SQL, extra fields and bulk arrays. It can only call
  existing current-authority replay logic; it cannot reset attempts or fences.
- Publish a numeric replay function version with no URL/API integration. A
  dedicated operator-assumable role may invoke only that version. Its execution
  role reads runtime credentials and dispatches exact queues/schedules, without
  bootstrap/DDL credentials or SMTP secret access. Administration remains separate.
- `OPENSIGHT_WORKER_SMTP_CAPABILITY=configured` is an operator-verified capability
  declaration. Request-side status may report it, but request execution remains
  unable to send or read SMTP credentials. Invalid declarations fail closed.
  Deployment verifies the declaration against the actual worker configuration
  and permission; it is part of the release configuration fingerprint.
- Cloud acceptance uses fixed, expiring operator plans and isolated synthetic
  schemas/queues/object prefixes. No event may name arbitrary resources, SQL,
  identities or recipients. Synthetic fixtures exercise recipient RLS/CLS with
  distinguishable totals. Real mail goes only to the approved private recipient.
- Failure hooks exist only in the separate acceptance runner, never in public
  handlers or ordinary workers. Exercise before/after commit, dispatch and SMTP
  receipt, duplicate/late delivery, current owner/recipient/tenant revocation and
  explicit ambiguous replay. Record actual AWS/SQS/SQL outcomes and safe counts.
  SMTP acceptance cannot prove inbox arrival or promise exactly-once delivery.
- Bound invocations, mail attempts, wall time and retries. No idle SQL poller,
  public debug route, production bulk redrive, NAT or provisioned concurrency.
  Delete isolated temporary resources after evidence collection; preserve required
  private receipts and existing production DLQ evidence.
