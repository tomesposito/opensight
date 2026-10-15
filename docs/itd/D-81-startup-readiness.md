---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-15
labels: [itd]
---

## Purpose

Make the deployment readiness check tolerate a bounded ingress cold start.

## Scope

The explicit empty startup wake in the public smoke helper and private controller.

## Out of Scope

Application request retries, authorization changes, provisioned concurrency or
changes to the database sleep policy.

### ✅ ITD D-81 — Which gateway startup failures may the deployment check retry?

#### CONTEXT

The live release check encountered an ingress initialization timeout at ten
seconds. Gateway access logs recorded HTTP 500 without an integration response;
the next explicit wake returned ready and the full authenticated smoke passed.
D-77 retries gateway 503 and WORKSPACE_STARTING but currently treats 500 as
terminal. AWS documents that an authorizer invocation failure can produce 500;
the generic response alone does not prove that the problem is transient.

#### THE PROBLEM

How should deployment readiness handle a generic gateway 500 while preserving
bounded failure and avoiding repeated business writes?

#### OPTIONS CONSIDERED

1. Fail immediately and require operator reconciliation for every such startup.
2. ✅ **Retry the exact generic gateway 500 only during the explicit empty wake.**
3. Retry arbitrary server errors throughout deployment smoke.

#### REASONING

Option 1 converts a recoverable observed cold start into an interrupted deploy.
Option 2 retains the existing six-attempt, ten-second interval bound and requires
an actual ready response. A persistent configuration error still fails the
check. Option 3 can replay business writes and conceal application failures.

#### IMPLICATIONS

- Retry HTTP 500 only when the JSON body contains exactly one property,
  `message`, with value `Internal Server Error`. Keep the existing exact generic
  503 and named WORKSPACE_STARTING handling.
- Other 500 payloads, denials and business operations retain existing behavior.
- Add recovery, exhaustion and payload-boundary tests. Keep public and private
  copies identical, repin the private controller and update its exact OIDC trust
  after owner merge. No additional AWS privilege is required.
- This extends [D-77](D-77-marketing-cutover.md); deployment still fails closed
  after unsuccessful readiness and still requires full authenticated smoke.

Reference: [AWS HTTP API Lambda authorizer troubleshooting](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html#http-api-lambda-authorizer.troubleshooting).
