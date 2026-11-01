---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-31
labels: [idd]
---

## Purpose

Record the product owner's 2026-10-31 decision supplied with issue #178.
This records the decision; it does not reopen it.

## Scope

Hosted in-app collection of user suggestions ("Ideas"), their review, and
their path into the build queue.

## Out of Scope

Self-hosted installs (no phone-home; GitHub issues remain that world's
public board), public voting boards, and any form of automatic building
from submissions.

### ✅ IDD D-88 — How should users suggest improvements, and who decides?

#### CONTEXT

Agent-built software makes it cheap to act on a user's plain-language
request (the "liquid software" pattern: a freeform input wired to an agent
that implements what is submitted). That pattern works in a personal,
single-user context. OpenSight is multi-tenant hosted software: an
unreviewed submission path into the build is a scope, security, and
product-direction risk, and popularity is not a product vision.

#### THE PROBLEM

How do users get the low-friction feeling of "tell it how you want it to
be different" without submissions ever building, or steering the product,
on their own?

#### OPTIONS CONSIDERED

1. No in-app channel; GitHub issues only.
2. In-app "Ideas" box with human review before anything is built.
3. ✅ **In-app "Ideas" box, private submissions, joint owner review —
   the recommendations the owner accepted on 2026-10-31.**

#### REASONING

1. GitHub-only excludes hosted users who will never file a GitHub issue.
2. A shared board with voting turns direction into a popularity contest
   and leaks build strategy; private submissions keep the signal without
   the pile-on.
3. A suggestion is input, never an instruction. The owner and Muse
   review submissions together against the product vision; accepted ideas
   become ordinary sweep issues and pass the usual IDD/HQ gates before
   any build. Declined ideas get a stated reason, not silence.

#### IMPLICATIONS

Issue #178 builds: an "Ideas" entry point (nav/help and empty states)
with a title + freeform description form; per-tenant storage with
submitter, workspace, originating surface, and product version; rate
limits matching the rest of the app; an operator-plane review queue;
and a per-submitter status list — Received → Under review → Accepted /
Declined (with reason) / Shipped (linking the release). Review digests
fold into the Monday persona-and-journey pass once the feature ships.
Nothing about a submission reaches an agent or a build automatically.
