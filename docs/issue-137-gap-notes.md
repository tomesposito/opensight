# Issue #137: verification and visual review

Usage tracking now has a typed server door, a tenant event log, bounded PostHog
capture and a tenant administrator off switch. The implementation and event
semantics are documented in [usage-tracking.md](usage-tracking.md).

## Verification

- Root `npm run build`: passed, including strict TypeScript.
- API analytics tests: **14 passed / 0 failed / 0 skipped**.
- Web AI settings tests: **4 passed / 0 failed / 0 skipped**.
- Root full-suite results are recorded below after the final run.

Targeted API command, from `packages/api`:

```sh
TZ=UTC node --test --test-isolation=none test/analytics*.test.mjs
```

The root suite uses UTC and a temporary directory on the workspace disk:

```sh
TZ=UTC TMPDIR="$PWD/.opensight/tmp" npm test
```

No live PostHog, AI provider, AWS or external network was used. Vendor transports
are fakes. No dependencies were added. `SOLUTION_DESIGN.md` was not edited.

An earlier full-suite attempt was stopped after the existing H4 flood test
exceeded its execution-time bound while Chromium capture/build work was also
running. That attempt has no complete totals. The final run starts after all
browser/build/ffmpeg work finishes; no test thresholds were changed. Early
focused attempts also exposed an incorrect working directory for existing v1
asset fixtures and missing required fields in the new embed test fixture. Both
were corrected before the final focused and root runs.

The next root attempt completed all non-web workspaces, but its longer TMPDIR
(`.opensight/issue-137/tmp`) caused Chromium's `Socket path too long` fatal error.
The web summary was 1,744 passed / 194 failed / 202 cancelled, with no skips;
root conformance did not run. The offline Chromium helper succeeds with the
shorter `.opensight/tmp` path on the same workspace disk. The final root rerun
uses that path without changing code, test expectations or skip conditions.

The subsequent root rerun was interrupted by a VM reboot after the API
query-replay/concurrency checks. Its partial output is not a completed result.
After resuming, the five implementation checkpoints and the pending item 6
files were reviewed without replaying completed commits. A fresh full root
run is required for the final totals below.

## Visual review

Rebuilt the production web app and `packages/web/dist/opensight-demo.html`.
`packages/web/scripts/capture-analytics-settings.mjs` drives the real built web
UI with a synthetic administrator, a local API and a stub analytics transport.
It verifies that turning the checkbox off persists the server override, with no
page errors, external requests or horizontal overflow at 390px width. Desktop
capture is 1440×1000; mobile viewport is 390×844. The initial capture revealed
an inherited form rule that placed the checkbox above its label; the scoped
checkbox-row fix is included and the corrected captures were reviewed.

Compared the settings form with the local `dyn-02-ai-settings.png` reference.
The new Analytics section follows the existing provider form; current shell and
navigation differences predate this issue. The reference has no Analytics
section. Added `docs/images/analytics-settings.png` and its README link.

Refreshed `docs/images/opensight-tour.gif` using the repository adaptation of
`~/workspace/tools/screenshots/readme-gif.mjs`,
`packages/web/scripts/capture-readme-tour.mjs`, and its ffmpeg palette assembly.
The completed tour contains 251 frames and reports zero browser errors or
external requests; the assembled GIF is 960×600 at 10 frames per second.
Compared the rebuilt author's Data → Visuals → sheet ordering with
`qs-2026/qs-autograph-empty.jpg`. The sheet remains the main canvas; the existing
demo notices and toolbar spacing remain different from QuickSight. No new
editor controls or editor-layout regressions were introduced. Visual fidelity
is not measured. These are local captures; the static demo is not a deployed
server. No new unresolved visual defect was found, and no network issue filing
was attempted under the brief's network restriction.

## Deliberate limits

- Browser-only sample selection/autosaves cannot emit a server event. The local
  v1 analysis save selecting the configured sample dataset is the honest signal.
- Generative and embedded question admission count one attempt. Structured query
  previews do not count again; browser-only deterministic O has no admission
  signal. Unsupported hosted AI routes remain unsupported.
- Tracking is best effort: a bounded memory queue and timed vendor requests,
  with no durable retry/outbox or exactly-once guarantee. A vendor failure keeps
  the already-written own-log copy. No analytics dashboards or marketing tracking.
- No push, merge or deployment is part of this branch build.

## Files changed by checkpoint

Files can appear in multiple checkpoints as later items wire earlier modules.

### 1 — Typed door and own log (`5bea4a85`)

- `packages/api/src/analytics-store.ts`
- `packages/api/src/analytics.ts`
- `packages/api/src/runtime-migration.ts`
- `packages/api/src/serverless-migration.ts`
- `packages/api/src/single-node.ts`
- `packages/api/test/analytics.test.mjs`

### 2 — PostHog transport (`edad9246`)

- `packages/api/src/analytics.ts`
- `packages/api/test/analytics.test.mjs`

### 3 — Composition (`6c16611a`)

- `packages/api/src/analytics-local.ts`
- `packages/api/src/analytics.ts`
- `packages/api/src/cli.ts`
- `packages/api/src/hosted-auth.ts`
- `packages/api/src/hosted-data.ts`
- `packages/api/src/hosted-provisioning.ts`
- `packages/api/src/hosted-server.ts`
- `packages/api/src/index.ts`
- `packages/api/src/serverless-application.ts`
- `packages/api/src/v1-routes.ts`
- `packages/api/test/analytics.test.mjs`

### 4 — Administrator off switch (`f6699309`)

- `packages/api/src/analytics-settings.ts`
- `packages/api/src/analytics-store.ts`
- `packages/api/src/analytics.ts`
- `packages/api/src/hosted-server.ts`
- `packages/api/src/index.ts`
- `packages/api/src/serverless-application.ts`
- `packages/api/test/analytics-routes.test.mjs`
- `packages/web/src/AISettings.tsx`
- `packages/web/src/api-client.ts`
- `packages/web/test/ai-settings-ui.test.mjs`

### 5 — Server event wiring (`5459aec6`)

- `packages/api/src/analysis-model.ts`
- `packages/api/src/analysis-routes.ts`
- `packages/api/src/asset-model.ts`
- `packages/api/src/asset-routes.ts`
- `packages/api/src/connector-routes.ts`
- `packages/api/src/dashboard-routes.ts`
- `packages/api/src/embed-content.ts`
- `packages/api/src/embed-session-routes.ts`
- `packages/api/src/embedding.ts`
- `packages/api/src/hosted-analyses.ts`
- `packages/api/src/hosted-auth.ts`
- `packages/api/src/hosted-data.ts`
- `packages/api/src/hosted-prep.ts`
- `packages/api/src/hosted-provisioning.ts`
- `packages/api/src/index.ts`
- `packages/api/src/ingestion-worker.ts`
- `packages/api/src/invitations.ts`
- `packages/api/src/local-analyses.ts`
- `packages/api/src/metadata-resources.ts`
- `packages/api/src/metadata.ts`
- `packages/api/src/o-generative.ts`
- `packages/api/src/organization.ts`
- `packages/api/src/prep-routes.ts`
- `packages/api/src/runtime-initial.ts`
- `packages/api/src/serverless-backup-schema.ts`
- `packages/api/src/serverless-backup.ts`
- `packages/api/src/serverless-worker.ts`
- `packages/api/src/sharing.ts`
- `packages/api/src/single-node-maintenance.ts`
- `packages/api/src/store.ts`
- `packages/api/src/v1-routes.ts`
- `packages/api/test/analytics-helpers.mjs`
- `packages/api/test/analytics-routes.test.mjs`
- `packages/api/test/analytics.test.mjs`
- `packages/api/test/embed-http-helpers.mjs`
- `packages/api/test/serverless-backup.test.mjs`

### 6 — Documentation, screenshots and final verification

- `CHANGELOG.md`
- `README.md`
- `docs/usage-tracking.md`
- `docs/issue-137-gap-notes.md`
- `docs/images/analytics-settings.png`
- `docs/images/opensight-tour.gif`
- `packages/web/scripts/capture-analytics-settings.mjs`
- `packages/web/src/AISettings.tsx` (checkbox-row class found during visual review)
- `packages/web/src/style.css` (scoped checkbox-row styling)
