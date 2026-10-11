---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-11
labels: [itd]
---

## Purpose

Choose an inexpensive public entry point for the authorized initial test site.

## Scope

CloudFront/API Gateway, viewer identity, origin secret custody and infrastructure
ownership. [SR4a](../phase5-sr4a-public-ingress.md) is the frozen implementation contract.

## Out of Scope

Database activation, tenant provisioning, recurring jobs, production recovery
and an automatic upgrade to a paid edge plan.

### ✅ ITD D-32 — How does the initial test site get public HTTPS with bounded idle cost?

#### CONTEXT

The operator has authorized completing the deployment and requested minimal cost.
The existing private Aurora/Lambda network is validated. SR3b removes idle client
polling. D-20/D-21/D-25 contain broader candidate ingress/release designs; current
AWS documentation now offers a Free flat-rate CloudFront plan with WAF, DNS,
managed policies, OAC and CloudFront Functions.

#### THE PROBLEM

Expose the actual application without adding a fixed-price load balancer/NAT,
duplicating the database, trusting a viewer's forwarded identity, or publishing
private deployment configuration.

#### OPTIONS CONSIDERED

1. ✅ **Free CloudFront plan, HTTP API custom origin, database-free authorizer,
   private S3 frontend and explicit edge-derived viewer IP.**
2. Pay-as-you-go WAF/CloudFront with custom origin policies.
3. Direct API/Lambda exposure or a continuously running reverse proxy.

#### REASONING

Option 1 fits the documented Free feature set while retaining both edge and
origin checks. Its managed origin policy excludes Host; an explicit edge-derived
peer header avoids depending on undocumented inclusion of CloudFront's viewer
address in that policy. The edge overwrites the header only after rejecting
viewer-supplied ingress fields; the shared-secret origin check remains required.
Option 2 adds a recurring WAF charge and is unnecessary if the Free configuration
is accepted. Option 3 weakens the selected ingress contract or adds idle compute.

#### IMPLICATIONS

- A separate Terraform state owns ingress and aliases; the existing root retains
  its network, database, function-code and artifact ownership. No duplicate owner
  or destructive migration is introduced.
- The origin secret is permitted only in protected private configuration/state;
  the dedicated authorizer can read only that secret, never database credentials.
- Public DNS cutover waits for ACTIVE/FREE plus application activation evidence.
  A failed Free-plan association does not authorize a paid tier or weaker checks.
- The initial profile uses three-day logs and existing database/budget settings.
  Free edge delivery does not make application, database or secret storage free.
- This confirms the initial ingress choices only. D-25's wider production release,
  restore and retention proposal remains separate; no such capability is claimed.

Sources: [CloudFront plan features](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html),
[managed origin policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html),
[Functions event structure](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html),
[subscription resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-pricingplanmanager-subscription.html).

#### AWS eligibility correction — 2026-10-11

AWS rejected the initial WAF resource for the Free subscription. The documented
Free capability is IP-based rate limiting; constant global aggregation is the
suspected incompatible feature. Keep startup-IP 30/5 minutes and dynamic-IP
600/5 minutes, and use the tighter API Gateway global startup throttle of
0.5 requests/second with burst two. This supports the two expected testers and
still bounds application wake traffic. Gateway-rejected traffic can incur API
charges; neither configuration is a hard spending cap. No identity/origin gate
changes and no paid tier is selected. Live subscription acceptance must verify
the corrected feature combination. A subscription-only rolled-back stack may be
removed after proving it owns no active subscription; retained ingress/data
resources are not part of that repair.
