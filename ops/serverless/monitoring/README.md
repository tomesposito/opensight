# Pilot queue monitoring

This root manages four CloudWatch alarms against the existing deployment's five
SQS queues. It creates no queue, function, database connection, notification
subscription or recovery action. It uses the same pinned OpenTofu/AWS provider
versions as the other serverless roots.

| Alarm | Metric | Threshold |
| --- | --- | --- |
| Work DLQ | Maximum visible messages | Above zero for one minute |
| Recovery DLQ | Maximum visible messages | Above zero for one minute |
| Scheduler DLQ | Maximum visible messages | Above zero for one minute |
| Source backlog | Maximum oldest-message age across work/recovery | Above 900 seconds for two of three minutes |

All metrics use `AWS/SQS`, exact queue names and 60-second periods. Missing data
is non-breaching because inactive queues can stop publishing. SQS metrics are
approximate; an OK alarm does not prove that every obligation has completed.
An existing DLQ backlog should alarm immediately; never raise the threshold to
hide retained evidence or delete messages to clear the alarm.

These alarms are **CloudWatch console indicators only**. Actions are disabled and
there is no email notification. Automatic replay is deliberately absent: replay
requires exact-event, current-authority and ambiguity checks under D-24.

Four alarms reference five standard-resolution metrics. At the published
us-east-1 rate of $0.10 per alarm metric/month, this is at most $0.50/month before
any account-wide free allowance. Metric math charges for each referenced metric.
Sources: [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/),
[alarm metric billing](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_billing.html),
[SQS metrics](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html).

## Operator application

Supply `region`, `account_id` and `deployment` through a private variable file.
Use the existing encrypted, versioned S3 state backend with `use_lockfile = true`
and a distinct monitoring state key. Never commit backend or variable values.
The AWS provider checks the supplied account; the operator also verifies STS
identity before running a plan.

Initialize with that private backend file, save the plan with `-out`, and inspect
its JSON. A first apply must contain exactly four `aws_cloudwatch_metric_alarm`
creates, no deletes/replacements, no actions and no unrelated resource changes.
Apply that exact reviewed plan. Subsequent plans must preserve the same bounded
inventory. Keep plan/state/evidence in private storage.

Offline validation uses `tofu init -backend=false`, `tofu validate` and
`tofu test`. Public CI includes this root in its mock-plan validation loop.
