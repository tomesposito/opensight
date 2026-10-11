---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-11
labels: [itd]
---

## Purpose

Implement the approved idle/reconnect experience without changing self-hosted
behavior or replaying authentication and business requests.

## Scope

The initial serverless frontend, embedded display lease, startup retry boundary
and the SDK's nonterminal connection-required event.

## Out of Scope

Ingress/WAF selection, infrastructure costs, authentication replacement, longer
session lifetimes and automatic replay of mutations.

### ✅ ITD D-31 — How do serverless clients reconnect without idle database requests?

#### CONTEXT

D-26 explicitly accepts hiding idle embeds and reconnecting on demand. SR2d now
provides durable uploads, foreground operation polling and verified results. The
remaining session, dataset-status and embed-status intervals would keep Aurora
awake. The operator has authorized completing the deployment and its development.

#### THE PROBLEM

How can clients become idle while preserving current authorization and the
existing single-use authentication boundaries?

#### OPTIONS CONSIDERED

1. ✅ **Explicit Connect, finite startup, local display expiry and a versioned
   connection-required SDK event in the serverless deployment mode.**
2. Remove timers everywhere, including all self-hosted clients.
3. Transparently replay failed sign-ins, bootstrap redemption and mutations after
   the database wakes.

#### REASONING

Option 1 implements D-26 and keeps self-hosted compatibility. Its startup helper
contains no credential or business body, so retries cannot duplicate a write or
consume a one-time proof twice. Option 2 changes unrelated self-hosted behavior.
Option 3 cannot distinguish a lost response from an uncommitted operation and is
rejected. Durable operations are inspected through their status endpoints.

#### IMPLICATIONS

- The serverless frontend uses a public boolean build flag; embed shells explicitly
  select the idle contract. Secrets and origins remain private runtime inputs.
- Connect runs at most six credential-free startup requests within 120 seconds.
  Retry only known starting/rate-limit responses. Hidden/unmounted pages abort it.
- Authoring session expiry remains local; foreground 401s prompt sign-in and
  workspace outages prompt Connect. No failed business request is replayed.
- An embed loses protected content after at most 45 seconds, or sooner on expiry,
  hide or freeze. Response latency cannot extend the lease. Reconnect rechecks
  authority and reloads content; an ambiguous redeem requires a new session URL.
- SDK `connectionRequired` is nonterminal and clears initial handshake timers.
  Its callback carries no data; origin/source/session/channel checks remain exact.
- Current runtime scheduling controls are unavailable; manual refresh and explicit
  status checks remain. No service worker or idle network timer is introduced.
- [SR3b's frozen contract](../phase5-sr3b-idle-clients.md) defines the precise state,
  retry and acceptance rules. D-21's separate ingress/abuse choices are not decided
  by this record. Cloud pause/resume and the real tester workflow still require
  deployment evidence.
