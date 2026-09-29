# AGENTS.md — how we build OpenSight

This is the working contract for anyone (human or agent) contributing to
this repo. `SOLUTION_DESIGN.md` is the design source of truth; this file
is the *process* source of truth: how we work, how we decide, and the
style we hold.

## 1. How we work

**Spec first, code second.** Every phase is specified in
`SOLUTION_DESIGN.md` before it is built. The spec is the contract — a
build implements exactly what the spec says, no more, no less. If the
spec is wrong, fix the spec in its own commit; never drift silently.

**One branch per phase.** Branch from `master`, name it
`work/<phase>-<topic>` (e.g. `work/phase3c-folders-sharing`). Commit
*only* on that branch. Never push from a build branch — publishing is a
separate, deliberate step.

**Checkpoint commits.** Commit incrementally as each spec item lands.
A phase is never one giant commit at the end. Each commit message names
the phase and the item (`Phase 3c: folder CRUD with validation`).

**Verify independently.** After the build, run the *full* test suite
from the repo root (`npm test`). Every suite must be green; the only
acceptable skip is the live-Postgres integration test (no live Postgres
in dev). Report exact counts: passed / failed / skipped.

**Merge, then publish.** Merge with `--no-ff` and a message naming the
phase. Publishing to GitHub goes through the Git Database API
(`gh-replicate-history`); plain `git push` may not work from all
environments. Note: tokens with only `public_repo` scope get a 404 from
the API when a tree contains `.github/workflows/*` — that file must be
added via the web UI or a re-scoped token.

**Rebuild the demo.** The static demo (`packages/web/dist`) is rebuilt
after every phase and screenshot-compared against the reference set
(see §4). Never present the static demo as a deployed server.

## 2. How we decide

These principles resolve trade-offs. In order:

1. **QuickSight compatibility first.** When in doubt, match QuickSight's
   behavior, naming, and semantics — that is the product goal.
2. **Honest over fake.** If a feature needs a hosted backend, say so in
   the UI ("needs hosted API"). Never fake functionality in the demo.
3. **Fail closed.** Unresolved principals, protected datasets without
   rules, denied columns — all denied with named errors. Never silently
   drop, never silently stale.
4. **Shared semantics across engines.** DuckDB, Postgres, and
   client/fixture paths must agree. SQL-mappable logic goes in the
   dialect layers; table calculations and level-aware aggregations live
   in shared post-processing. Differential tests prove it.
5. **Dependencies: MIT/Apache-2.0 only.** Verify every new dependency's
   license. Commercial-licensed libraries are forbidden.
6. **Nothing personal, ever.** No credentials, tokens, customer data,
   private hostnames, account IDs, or unsanitized exports in the repo.
   Configuration comes strictly from environment variables.

## 3. Code style

- **TypeScript strict** everywhere. No `any` without justification.
- **API:** plain `node:http`, resource routes with validation, named
  errors. Follow the existing route/validation patterns in
  `packages/api`.
- **Web:** React 19 + Apache ECharts 6 via the visual compiler
  (definition → compiler → ECharts options). Maps are dependency-free
  and offline — no commercial tiles or API keys.
- **Tests** live next to what they test and are wired into root
  `npm test`: scheduler tests use fake timers, email tests use the stub
  transport, security tests include explicit bypass attempts.
- **Docs:** each phase gets a short doc in `docs/` (resources,
  configuration, semantics). Keep them factual and current.

## 4. UI style guide

The builder models the QuickSight analysis editor:

- **Left-to-right flow.** Data panel → Visuals/field-wells panel →
  analysis sheet as the *primary focus*. The sheet canvas is dominant;
  controls dock left in a predictable order and support the build.
  No floating boxes competing with the canvas.
- **Chrome.** Dark navy menu toolbar (File Edit Data Insert Sheets
  Objects Search), FIT TO WIDTH, PUBLISH (honest stub until hosted),
  NEW LOOK light/dark theme toggle, per-visual palettes.
- **Properties panel** mirrors QuickSight's sections: Display settings,
  Headers/Cells, Totals/Subtotals, Row/Column/Value names, Conditional
  formatting, Analysis theme.
- **Look-and-feel loop.** After each phase, capture the demo and compare
  against the reference screenshots. Record findings in the gap notes;
  file anything user-visible as a GitHub issue and schedule it into the
  phase plan.
- **README stays great.** The README hero GIF (`docs/images/opensight-tour.gif`)
  and feature screenshots (`docs/images/`) are refreshed on every phase that
  changes user-visible UI — never older than the latest shipped phase.
  Regenerate the GIF with the capture script
  (`~/workspace/tools/screenshots/readme-gif.mjs` + the ffmpeg assembly
  commands at its bottom) against the freshly rebuilt demo, then re-capture
  any feature screenshots whose UI changed.

## 5. What we don't do

- No AWS calls or spending from builds. Deployment is design-only until
  explicitly authorized.
- No network access in builds beyond `npm install`.
- No editing `SOLUTION_DESIGN.md` inside a build phase — it's the
  contract, not a scratchpad.
- No claiming parity we haven't measured. The demo footer says it:
  *visual fidelity not measured.*

## 6. Pull-request workflow (planned — not yet adopted)

When the project outgrows merge-straight-to-main:

- **Branches:** `work/<phase>-<topic>` land only via PR into `master`.
  Branch protection: no direct pushes, CI must pass.
- **CI:** GitHub Actions builds and tests every PR (the workflow file
  needs adding via web UI or a re-scoped token — see §1).
- **Reviews:** the assistant reviews Codex's PRs (full suite, spec
  compliance, AGENTS.md principles, screenshot compare for UI). A second
  Codex run reviews the assistant's PRs (specs, docs, small fixes).
- **Tom** reviews only product-level decisions and vision — never a
  bottleneck on routine PRs.
- **Merge style:** `--no-ff` merge commits (keeps phase history
  readable); revisit if it gets noisy.
