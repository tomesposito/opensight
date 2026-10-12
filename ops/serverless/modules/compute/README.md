# OpenSight compute module

Lambda functions (request/work/recovery/migration/probe), IAM roles with
least-privilege policies, SQS queues, EventBridge Scheduler groups, and the
monthly cost budget alarm.

The `pilot` profile adds the durable business queues, schedule group, event
source mappings, and artifact-bucket CORS. Pilot resources are additive and
can be reviewed before enabling the pilot runtime.

## Inputs

Cross-module references (VPC, data) arrive as variables. See `variables.tf`.
