---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-10
labels: [itd]
---

## Purpose

Make every runtime network destination and fixed network charge explicit for SR0.

## Scope

PostgreSQL, objects, secrets, dispatch, mail and approved source connections.

## Out of Scope

Provisioning, network experiments, credentials, spending approval and arbitrary
internet connectors. Prices below are examples, not an account quote.

### 🚧 ITD D-19 — Which egress profile should the first serverless deployment use?

#### CONTEXT

[D-18](D-18-serverless-development-deployment.md) selects VPC-connected Lambda
and private Aurora. H7 needs real invitation/report mail and H3 supports
operator-allowed PostgreSQL sources. A public subnet alone gives Lambda no public
internet route. Fixed interface endpoints can exceed the database compute cost
of this lightly used deployment.

#### THE PROBLEM

Which explicit network profile provides the required transports at an acceptable
idle cost without silently narrowing connector or delivery scope?

#### OPTIONS CONSIDERED

1. [WIP] Private service endpoints, with PostgreSQL sources reachable through
   separately approved private routes; no general internet route.
2. [WIP] Dual-stack Lambda subnets and IPv6 egress-only internet gateway for
   destinations with verified IPv6 support, plus endpoints for remaining services.
3. [WIP] NAT Gateway egress for IPv4 destinations, retaining the free S3 gateway
   endpoint; one-AZ or two-AZ placement priced separately.

#### REASONING

Option 1 covers the mandatory AWS paths and reuses the existing implicit-TLS
SMTP transport, but its four endpoints create a fixed floor before application
usage. Option 2 is the candidate to validate because it can remove that floor.
Each exact endpoint, SDK setting, DNS answer, TLS path and chosen region still
needs proof; advertised dual-stack support is not enough. It cannot reach an
IPv4-only internet source. Tom must confirm the pilot's actual source destinations;
H3 itself is not disabled.
Option 3 has the widest compatibility but creates a larger idle floor and broader
egress exposure.

**2026-10-10 review update:** the operator selected an IPv6-first validation plan
and continued developer preparation. Option 2 now replaces option 1 as the
candidate to validate. This is approval to prepare the plan, not to provision
resources or claim successful transport. The decision remains draft until the
exact paths pass the separately approved cloud experiment. Do not automatically
fall back to paid endpoints or NAT if a path fails.

#### IMPLICATIONS

The following matrix defines the **option 2 validation candidate**. The regional
AWS names below are public service endpoints, not private deployment inputs.
Region selection and actual configuration are injected through environment
variables. The initial measurement uses the US East (N. Virginia) price example.

| Caller → destination | Protocol and route | Authority and failure contract | Charged endpoint count |
| --- | --- | --- | --- |
| API/worker/migration → Aurora | Private TCP 5432, VPC local route, verified TLS with RDS trust bundle | DB security group admits named runtime groups; tenant role remains non-owner/NOBYPASSRLS; no public DB endpoint | 0 |
| API/worker → uploads/artifacts | HTTPS 443 through regional S3 **gateway** endpoint | IAM plus bucket/endpoint policies limit bucket/prefix and operations; tenant checks precede I/O | 0 |
| Browser → upload object | HTTPS 443 to regional S3 using bounded presigned PUT | Private bucket; scoped signature; do not require this browser path to originate from the VPC endpoint | 0 |
| Runtime → Secrets Manager | HTTPS 443 over IPv6 to `secretsmanager.us-east-1.amazonaws.com` | Environment-specified references only; bounded fetch; no secret logs; missing/retired version fails closed | 0 |
| Runtime → SQS | HTTPS 443 over IPv6 to `sqs.us-east-1.api.aws` | Assigned work/recovery/DLQ queues only; no rows or credentials in messages | 0 |
| Dispatcher → EventBridge Scheduler | HTTPS 443 over IPv6 to `scheduler.us-east-1.api.aws` | Deployment schedule group, approved SQS target and narrowly scoped PassRole | 0 |
| Delivery worker → SES SMTP | TCP 465 implicit TLS over IPv6 to `email-smtp.us-east-1.api.aws` | Verify certificate; private SMTP secret; verified sender/sandbox recipients; reauthorize before DATA; no plaintext fallback | 0 |
| Worker → tenant PostgreSQL source | Approved private TCP host/port with verified TLS/routing | Existing allowlist, tenant secret and SSRF checks; unknown routes return named unavailable state | Separate route costs if needed |
| Runtime → DNS | VPC resolver | Fixed approved service names; source resolution retains SSRF protections; DNS is not authorization | 0 |
| Scheduler/SQS → Lambda | AWS service invocation/event-source mapping | Resource/role policies bind source and deployment; runtime has no SQS polling loop | No runtime endpoint |
| Lambda platform → image/log services | Managed image pull and stdout/stderr logging | No runtime ECR or Logs SDK calls in this profile | No runtime endpoint |

Direct SDK calls to KMS, STS, Lambda, EventBridge event bus or CloudWatch APIs
are not required by this matrix. S3/Secrets service-side encryption and
Lambda-provided role credentials do not imply a runtime KMS/STS call. Adding such
a call adds a route and price. Scheduled work uses Scheduler plus SQS, not
`PutEvents`. SMTP and SES HTTPS endpoints are different services; changing the
transport must not accidentally purchase both endpoints.

All four named service endpoints returned AAAA records during the read-only
review on 2026-10-10. This is evidence of DNS availability only. In the real
Lambda image, prove SDK endpoint selection, IPv6 socket use, TLS/SNI validation,
IAM authorization, SMTP authentication and bounded failure. SQS operations must
not revert to an IPv4-only host through a returned QueueUrl. Configure dual-stack
subnets, `Ipv6AllowedForDualStack=true` and an egress-only internet gateway;
keep Aurora private and S3 on its gateway endpoint.

IPv6 egress does not provide a service-name firewall: security groups cannot
enforce an FQDN allowlist, and there is no interface-endpoint policy on these
paths. Enforce destinations in typed application configuration, retain source
SSRF checks, and scope IAM/resource policies to the deployment. Do not describe
an outbound 443 rule as denying every other internet destination. The validation
does not promise arbitrary IPv4-only source connectivity; a public IPv4-only
source would require a separate route/cost decision. Existing H3 semantics stay
intact, and unsupported routes fail explicitly.

The ingress authorizer has no database access and uses deployment-injected ingress
key material outside the VPC. Injection is a private release operation. Application
secrets are resolved at invocation entry, within its deadline, into typed options.
No credential file/static AWS key enters either repository. Cached secrets must
respect active key versions; an old warm process cannot reactivate a retired key.

**Endpoint cost decision (USD, 730 hours/month, published US example rates,
checked 2026-10-10; reprice selected region before approval):**

| Item | Unit assumption | One endpoint AZ | Two endpoint AZs |
| --- | --- | ---: | ---: |
| Secrets Manager interface endpoint | $0.01/endpoint-AZ-hour | $7.30 | $14.60 |
| SQS interface endpoint | Same | $7.30 | $14.60 |
| Scheduler interface endpoint | Same | $7.30 | $14.60 |
| SES SMTP interface endpoint | Same | $7.30 | $14.60 |
| **Option 1 fixed network subtotal** | Four services | **$29.20/month** | **$58.40/month** |
| Interface data processing | $0.01/GB at first tier | Usage extra | Usage extra |
| S3 gateway endpoint | No hourly/processing charge | $0 | $0 |
| **Option 2 selected validation candidate** | Egress-only IPv6 gateway + S3 gateway; no interface endpoints | **$0 fixed gateway/endpoint charge** | **$0 fixed gateway/endpoint charge** |
| Option 3 NAT, alternative interface routes | $0.045/hour + $0.005/public IPv4-hour per gateway | $36.50/month | $73.00/month |
| NAT processing | $0.045/GB | Usage extra | Usage extra |

Cross-AZ and internet transfer are additional. One endpoint AZ can serve runtime
subnets in another AZ but introduces cross-AZ traffic and an availability
dependency; Aurora still needs its required DB subnet coverage. Option 2 has no
egress-only gateway hourly fee, but transfer and retained endpoints remain.
No NAT instance, proxy, Data API adapter or Redis is an unpriced fallback.

**Remaining deployment gate:** approve the concrete resource/cost plan, prove
option 2, and confirm the pilot's source destinations before public release.
SMTP remains the selected transport; start with verified SES sandbox test
recipients. Do not remove real mail to meet an undeclared budget. External AI/new
connector destinations need their own entry. See the
[AWS validation plan](../phase5-aws-validation-plan.md).

**Acceptance:** deny unlisted destinations, wrong bucket/queue/secret and source
DNS rebinding; mail certificate failure is fatal and deployment cannot select
the test stub. SR5 separately proves each route and AZ/service support. Route
outage returns a named unavailable error with no unreviewed transport fallback.

Evidence: [Lambda egress](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html),
[Scheduler PrivateLink](https://docs.aws.amazon.com/scheduler/latest/UserGuide/vpc-interface-endpoints.html),
[SES endpoints](https://docs.aws.amazon.com/ses/latest/dg/send-email-set-up-vpc-endpoints.html),
[PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/),
[VPC/NAT/IPv4 pricing](https://aws.amazon.com/vpc/pricing/),
[Lambda IPv6](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html),
[egress-only gateway](https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html),
[Secrets Manager IPv6](https://docs.aws.amazon.com/secretsmanager/latest/userguide/ip-access.html),
[SQS endpoints](https://docs.aws.amazon.com/general/latest/gr/sqs-service.html),
[Scheduler endpoints](https://docs.aws.amazon.com/general/latest/gr/eventbridgescheduler.html),
[SES SMTP endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html).


### SR4a SMTP credential custody (2026-10-10)

The operator approved one private notification/test address. Account inspection
found no reusable isolated SMTP secret and SES remains in sandbox mode. Follow
[the frozen SR4a contract](../phase5-sr4a-packaging.md): one tagged IAM SMTP user,
no console access, SendRawEmail restricted to the approved sender/recipient,
private in-memory regional password derivation and Secrets Manager storage.
No access-key resource or secret value enters Terraform state. Count at most
twenty mail attempts including ambiguous outcomes; explicitly revoke credentials
on cleanup. Verify the approved email identity without requesting production
access. This fills the existing SES validation inventory; it does not authorize
public email delivery or relax the runtime's recipient authorization rules.
