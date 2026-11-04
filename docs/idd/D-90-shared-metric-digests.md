---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-11-03
labels: [idd]
---

# D-90 — Shared metric digest destinations

## Purpose

Record the shared-list decision supplied in the reopened issue #162 build brief,
from Tom's comments 6617287095 and 6619715093.

## Scope

Membership, shared data visibility and lifecycle of metric email digests.

## Out of Scope

Slack, external email destinations, source credential sharing and new alerts.

## CONTEXT

Personal digests already ship. Shared destinations previously failed closed
because membership authority and recipient-specific data semantics were unresolved.

## THE PROBLEM

Which recipients and which data may appear in one shared digest?

## OPTIONS CONSIDERED

- Arbitrary email lists do not establish verified workspace membership.
- Separate personal views produce different messages and do not meet the shared
  message contract.
- Explicit workspace members with the strictest common access define one
  authorized audience and result.

## REASONING

Tom selected explicit member lists and strictest-recipient intersection for #162.
A row or column may appear only if every remaining recipient is authorized.
The current identity registry supplies membership; the creator chooses IDs
explicitly, and delivery resolves them again. The existing owner/admin creation
gate stays. An empty intersection must be disclosed rather than widened.

## IMPLICATIONS

Drop removed and de-authorized recipients; fail closed when none remain. Send
one message per subscription/period, with a metric drill-back and a token that
stops the entire subscription. Owner removal stops the job; recipient removal
only changes future audiences. Keep execution on the subscription owner's
existing governed path, narrowed by recipient policies. The exact supported
recipient checks and owner-bound execution limitation are documented in
[metric digests](../metric-digests.md#current-execution-boundary).
