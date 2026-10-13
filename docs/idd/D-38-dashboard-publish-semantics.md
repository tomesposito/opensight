---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-13
labels: [idd]
---

## Purpose

Decide what "publish" means for a dashboard in OpenSight — what a reader
gets, when a shared link changes, and what the API commits to. This is
contract-freeze question 6 from #95: the dashboards slice cannot build
until this is answered. Nothing here is decided; the loop proposes, the
product owner disposes.

## Scope

The meaning of publish for dashboards: the reader experience, shared and
embedded links, versioning, and the audit story — for the headless API and
the UI alike.

## Out of Scope

Billing/metering on API usage (gated behind HQ-14 entitlement work);
multi-region; SLAs. The pilot is single-tenant-scoped like everything
else (per #95).

### 🚧 IDD D-38 — What should dashboard publish semantics be?

#### CONTEXT

The headless API work (#95, D-37 ✅) says dashboards support "publish,
share, snapshot/export." The frozen contract (questions 1–5 and 7) is
recorded in `docs/api-contract-v1-draft.md`; question 6 — what publish
actually means — is still open. There was no IDD for it, which is why it
was a freeze question rather than an oversight.

What exists today:

- `GET /dashboards` (list) and `GET /dashboards/{id}/definition` (read
  the QuickSight-shaped envelope), plus share CRUD
  (`GET|PUT|DELETE /dashboards/{id}/shares(/user/{userId}|/group/{groupId})`).
- The UI's PUBLISH is an honest stub (repo AGENTS.md §4: "PUBLISH (honest
  stub until hosted)"). Today there is no durable difference between a
  dashboard's working state and its published state.
- Report rendering and snapshot machinery already exist
  (`packages/api/src/reports.ts`, `job-renderer.ts`), but there is no
  dashboard-scoped endpoint for them.

The two options the freeze draft named:

- **Snapshot-and-version** (recommended by the draft): publishing captures
  an immutable, versioned snapshot of the dashboard. Shared links never
  change under the reader; every publish is auditable. Composes with the
  SR4b immutable-release thinking (issue #86) already in the repo. Costs
  some storage per version.
- **Live reference**: the dashboard always reflects the current analysis
  state. Always fresh, simpler to build — but shared links can change
  under readers and there is no audit trail of what was published when.

#### THE PROBLEM

An agent calling "publish" — and a human sharing a dashboard link — needs
one predictable meaning: does the reader see what the dashboard looked
like when it was published, or whatever it looks like now? The answer
shapes the API contract (endpoint shapes, idempotency, versioning), the
storage model (snapshots cost space and need retention), and the trust
story (embeds and shared links in the HQ-6/HQ-12 QuickSight-compat shapes
point at published dashboards).

#### OPTIONS CONSIDERED

1. **Snapshot-and-version.** Each publish writes an immutable version
   (definition snapshot, plus optionally rendered snapshots from the
   existing report machinery). The dashboard keeps a version history;
   shared and embedded links can pin a version or follow "latest."
   Readers always see exactly what was published; every publish is
   auditable. Cost: storage per version, so retention policy becomes a
   real question (keep N versions? forever?). This is the direction SR4b
   already takes for releases, so the product would tell one consistent
   story: published things are immutable and auditable.

2. **Live reference.** Publish is a state flag on the dashboard, not a
   snapshot. Readers always see the current analysis state — the freshest
   data and the latest layout, no version bookkeeping. Simpler to build
   and cheaper to store. But a shared link can change under the reader
   (someone edits the analysis after sharing), and there is no record of
   what anyone saw. For embedded dashboards (HQ-6/HQ-12), a live
   reference means the embedding site's content can shift without the
   embedder doing anything.

3. **Versioned snapshots with a movable "latest" alias.** The middle
   ground: every publish still writes an immutable version (audit trail,
   pinnable links), but the default shared link follows a "latest" alias
   that moves on each publish. Readers who want stability pin a version;
   readers who want freshness use the alias. More surface to build and
   document (two link behaviors), but it avoids forcing every consumer
   into one semantics.

#### RECOMMENDATION (loop's proposal, not a decision)

Option 1, snapshot-and-version — for the reasons the freeze draft named:
immutable published artifacts are auditable, shared links are
trustworthy, and the story composes with SR4b's immutable releases.
Option 3 is a reasonable fallback if the "always fresh" use case turns
out to matter more than the audit story; option 2 is the simplest but
gives up the trust story that makes published dashboards worth sharing.

None of this is decided. The dashboards slice waits on the product
owner's call.

#### IMPLICATIONS

- **API contract:** publish becomes a mutation that returns a version
  identifier (under option 1/3), not a flag flip. `Idempotency-Key`
  already covers it (frozen in the contract). Read endpoints gain a
  version parameter; the default is the latest published version, never
  the working draft.
- **Draft vs. published:** the working analysis stays the draft; the
  dashboard's published versions are separate artifacts. Editing an
  analysis never rewrites a published version under option 1/3.
- **Storage and metering:** snapshots cost storage per version — the
  retention policy (keep N, keep forever, operator-configured) is a real
  decision, and it composes with the HQ-14 metering foundation D-37
  already committed to.
- **Snapshots vs. definitions:** still open whether a version stores only
  the definition or also rendered snapshots (the report machinery exists
  and could serve this). The dashboards slice should propose this.

#### OPEN QUESTIONS (for the product owner)

1. Snapshot-and-version, live reference, or the hybrid (option 1, 2, 3)?
2. If versioned: retention policy — keep every version, keep N, or
   operator-configured? (This becomes a storage/money question at scale.)
3. Does a published version include rendered snapshots, or just the
   definition? (The report machinery exists; using it is a product call.)
4. Who can publish, and does publishing require the analysis to be in a
   clean state? (e.g. unpublished analyses can't be published —
   probably, but say so.)

Related: [#95](https://github.com/tomesposito/opensight/issues/95),
[D-37](D-37-headless-first-api.md), [issue #86](https://github.com/tomesposito/opensight/issues/86) (SR4b immutable releases).
