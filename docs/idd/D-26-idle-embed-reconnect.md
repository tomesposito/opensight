---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-10
labels: [idd]
---

## Purpose

Choose the idle embedded-dashboard experience for the first serverless test
deployment while preserving the existing revocation guarantee.

## Scope

Protected embed display expiry and deliberate reconnection in the initial test
deployment.

## Out of Scope

Public-pilot availability promises, startup timing guarantees, WAF/IP allowlist
approval, infrastructure creation and spending.

### ✅ IDD D-26 — What should an idle embedded dashboard show in the first test deployment?

#### CONTEXT

D-18 prioritizes low idle cost and Aurora auto-pause. H6's existing status polling
keeps checking current authority to meet HQ-7's 60-second revocation bound, but
that polling can keep database compute awake. D-21 proposes a 45-second local
display lease and explicit reconnection. On 2026-10-10, the product owner accepted
hiding idle embed data after 45 seconds and showing Connect.

#### THE PROBLEM

How should idle embeds preserve the revocation guarantee without continuously
waking the database?

#### OPTIONS CONSIDERED

1. ✅ **Hide protected data after a maximum 45-second display lease and require
   an explicit Connect action to restore it.**
2. Continue checking authority while a passive dashboard is visible, accepting
   the resulting database awake cost.
3. Leave expired protected content visible without checking authority.

#### REASONING

Option 1 fits the minimal operator/agent test audience and the accepted cold-wake
trade-off. Passive dashboards become unavailable until the user reconnects;
that product behavior is explicitly accepted. Option 2 better serves continuous
passive viewing, but conflicts with the initial idle-cost objective. Option 3
would weaken HQ-7 and is rejected.

#### IMPLICATIONS

- Measure the 45-second maximum from the last successful current-authority
  check, capped by session expiry. Mouse movement and timers do not extend it.
- On expiry, hide protected data locally and show Connect without a request.
  No background status/startup polling may keep an idle embed authorized.
- Hide on visibility loss. When a page resumes, check elapsed wall time before
  rendering protected content; it stays hidden until explicit Connect and a
  successful current-authority check. A frozen timer cannot extend authority.
- Connect uses the bounded startup/authentication flow and restores data only
  after authorization succeeds. Never automatically replay a single-use
  bootstrap redemption, MFA submission or mutation after an ambiguous response.
- Preserve HQ-7's 60-second revocation ceiling, existing session lifetimes,
  single-use bootstrap and memory-only credentials. This is a display lease,
  not a new session lifetime or an authentication bypass.
- Hiding an embed does not pause Aurora immediately. All work/connections must
  finish and the configured database idle period must elapse; other active
  clients or scheduled work can still keep the database awake.
- The product decision unblocks the corresponding D-21/SR3 UI contract. Define
  SDK states/events and client tests in a separate spec commit before building;
  verify expiry, hidden/frozen pages, reconnect failures and zero idle requests.
  Other D-21 transport/abuse choices remain draft. No AWS spending is approved.

Related: [D-21](../itd/D-21-aurora-readiness.md),
[D-18](../itd/D-18-serverless-development-deployment.md),
[developer handoff](../phase5-developer-handoff.md).
