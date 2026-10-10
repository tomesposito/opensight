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

Option 1 is the proposed implementation profile because all mandatory AWS paths
are enumerated below and SMTP can reuse the existing implicit-TLS transport.
It limits source connectivity to approved reachable PostgreSQL endpoints. Tom
must decide whether that restriction fits the pilot; H3 itself is not disabled.
Option 2 can reduce fixed charges but is not selected merely because a service
advertises dual-stack: each exact endpoint, SDK setting, DNS answer, TLS path
and chosen region needs later proof. It cannot reach an IPv4-only source.
Option 3 has the widest compatibility but creates a larger idle floor and broader
egress exposure. No option or availability-zone count is approved by this record.

#### IMPLICATIONS

The following is the buildable **option 1** matrix. Selecting another option
requires updating affected rows, tests and estimate before its build.

| Caller → destination | Protocol and route | Authority and failure contract | Charged endpoint count |
| --- | --- | --- | --- |
| API/worker/migration → Aurora | Private TCP 5432, VPC local route, verified TLS with RDS trust bundle | DB security group admits named runtime groups; tenant role remains non-owner/NOBYPASSRLS; no public DB endpoint | 0 |
| API/worker → uploads/artifacts | HTTPS 443 through regional S3 **gateway** endpoint | IAM plus bucket/endpoint policies limit bucket/prefix and operations; tenant checks precede I/O | 0 |
| Browser → upload object | HTTPS 443 to regional S3 using bounded presigned PUT | Private bucket; scoped signature; do not require this browser path to originate from the VPC endpoint | 0 |
| Runtime → Secrets Manager | HTTPS 443, private DNS interface endpoint | Environment-specified references only; bounded fetch; no secret logs; missing/retired version fails closed | 1 service × AZ count |
| Runtime → SQS | HTTPS 443, private DNS interface endpoint | Assigned work/recovery/DLQ queues only; no rows or credentials in messages | 1 service × AZ count |
| Dispatcher → EventBridge Scheduler | HTTPS 443, private DNS interface endpoint | Deployment schedule group, approved SQS target and narrowly scoped PassRole | 1 service × AZ count |
| Delivery worker → SES SMTP | TCP 465 implicit TLS through regional `email-smtp` interface endpoint | Verify certificate; private SMTP secret; verified sender/sandbox recipients; reauthorize before DATA; no plaintext fallback | 1 service × AZ count |
| Worker → tenant PostgreSQL source | Approved private TCP host/port with verified TLS/routing | Existing allowlist, tenant secret and SSRF checks; unknown routes return named unavailable state | Separate route costs if needed |
| Runtime → DNS | VPC resolver | Service names and validated source destinations; DNS changes cannot bypass endpoint policy | 0 |
| Scheduler/SQS → Lambda | AWS service invocation/event-source mapping | Resource/role policies bind source and deployment; runtime has no SQS polling loop | No runtime endpoint |
| Lambda platform → image/log services | Managed image pull and stdout/stderr logging | No runtime ECR or Logs SDK calls in this profile | No runtime endpoint |

Direct SDK calls to KMS, STS, Lambda, EventBridge event bus or CloudWatch APIs
are not required by this matrix. S3/Secrets service-side encryption and
Lambda-provided role credentials do not imply a runtime KMS/STS call. Adding such
a call adds a route and price. Scheduled work uses Scheduler plus SQS, not
`PutEvents`. SMTP and SES HTTPS endpoints are different services; changing the
transport must not accidentally purchase both endpoints.

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
| Option 3 NAT, alternative interface routes | $0.045/hour + $0.005/public IPv4-hour per gateway | $36.50/month | $73.00/month |
| NAT processing | $0.045/GB | Usage extra | Usage extra |

Cross-AZ and internet transfer are additional. One endpoint AZ can serve runtime
subnets in another AZ but introduces cross-AZ traffic and an availability
dependency; Aurora still needs its required DB subnet coverage. Option 2 has no
egress-only gateway hourly fee, but transfer and retained endpoints remain.
No NAT instance, proxy, Data API adapter or Redis is an unpriced fallback.

**Tom's decision:** choose option, endpoint AZ count, source reachability and
email transport; accept the fixed floor and regional estimate. Do not remove
real mail to meet an undeclared budget. External AI/new connector destinations
need their own entry. SR1 networking and SR3 mail depend on this decision.

**Acceptance:** deny unlisted destinations, wrong bucket/queue/secret and source
DNS rebinding; mail certificate failure is fatal and deployment cannot select
the test stub. SR5 separately proves each route and AZ/service support. Endpoint
outage returns a named unavailable error with no public fallback.

Evidence: [Lambda egress](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html),
[Scheduler PrivateLink](https://docs.aws.amazon.com/scheduler/latest/UserGuide/vpc-interface-endpoints.html),
[SES endpoints](https://docs.aws.amazon.com/ses/latest/dg/send-email-set-up-vpc-endpoints.html),
[PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/),
[VPC/NAT/IPv4 pricing](https://aws.amazon.com/vpc/pricing/).
