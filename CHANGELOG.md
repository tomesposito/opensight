# Changelog

All notable changes to OpenSight are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

No numbered release has been cut yet, so every shipped change so far sits
under Unreleased. When the first release is cut, the release flow moves the
Unreleased entries into a new version section (see AGENTS.md §1).

## [Unreleased]

### Added

- Hosted readers can open published prepared dashboards when independently
  authorized for every recipe source. Recipes execute on reader-scoped data,
  including joins and aggregates, without reusing publisher prepared caches;
  missing or revoked source access fails closed (#155, D-85).
- Durable monthly hosted usage records and operator reporting for admitted and
  denied API calls and compute attempts, current storage snapshots, and explicitly
  recorded egress bytes, preparing usage-based billing without changing quotas (#154).
- Tenant erasure now defaults to a read-only store inventory, requires exact
  tenant confirmation to execute, purges private assets and cache entries,
  verifies leftovers, and supports safe retries while retaining audit history
  under normal retention (#115).
- Invited users can set a password and register TOTP from the emailed browser
  link, with a scannable QR code and manual setup key, then sign in with a fresh
  authenticator code and open their workspace or workspace picker. Existing
  users can accept another workspace invitation after signing in (#152).
- Hosted authors can save analyses and publish versioned dashboards from the
  editor. Hosted Home and My stuff list accessible tenant dashboards; readers
  open live visual queries, authored parameter controls, and a docked Ask O
  panel for AI roles. Administrators can grant dashboard viewing access while
  independent dataset permissions remain enforced (#151).
- Hosted workspace administrators can invite members in all five roles, share
  single-use invitations, and list or revoke pending invitations within their
  own workspace. Invitations expire after seven days by default; member removal
  remains operator-managed with the required schedule disposition (#150).
- The hosted pipeline now serves the marketing site's `robots.txt` and
  `sitemap.xml` on the marketing host (correct plain-text and XML content
  types; the app host still returns 404 for both), completing the live
  serving side of the crawler and sitemap work (#149, follow-up to #134).
- Opt-in tenant usage tracking with a private event log, content-free PostHog
  events, and an administrator off switch (#137).
- Marketing site crawler rules, public sitemap, social sharing metadata,
  an approved QuickSight alternative introduction, and an October 2026
  freshness line (#134).
- This changelog, with the update process documented in AGENTS.md (#116).
- Workspace display names and a login-screen workspace picker: operators set
  a display name and unique slug at provisioning, the name shows in the
  invitation, the picker, and the app header, and `tenant_id` stays internal
  and never needs to be typed or remembered (#146, D-83).
- Per-tenant AI spend caps, enforced against the tenant's usage meter (#114).
- Dependency audit gate: `npm run audit` fails on high/critical advisories,
  with the triage process documented in `docs/dependency-triage.md`
  (#111, automation groundwork; the Dependabot and CI files are an owner
  web-UI step and are still pending).
- New OpenSight brand identity — mark, lowercase wordmark, and brand-blue
  accents — across the app header and navigation, first-run, sign-in, the
  author topbar, the README, and the marketing site (#109).
- Headless API v1: the versioned API contract and surfaces for analyses,
  dashboards, datasets and sources, and querying, with a TypeScript SDK, a
  Python SDK, a CLI, and an MCP server (#95).
- Marketing site for getopensight.org: landing page, live-demo entry points,
  and the packaged apex/app routing (#93, #106).

### Changed

- The question side panel is branded "Ask O" (trigger mark "O", heading
  "ASK O") and docks into the layout — the shell reserves its width instead
  of the panel overlaying the canvas (#135, #136).
- Editor polish passes: an exhaustive interactive audit of the app
  (866 elements, 637 unique surfaces, light and dark) drove a long run of
  hover and paint fixes; the final re-audit came back empty and the polish
  bucket closed (#108).

### Fixed

- Fresh hosted workspaces show a real empty dashboard collection for every role
  instead of the pinned synthetic sales showcase. Local sample opt-in and demo
  publication notices retain their existing behavior (#151).
- Dashboard visuals now stack when the available content width is narrow,
  preventing overflow beneath the docked Ask O panel while preserving the
  wide desktop layout (#140).
- Explicit workspace startup now budgets from invocation entry so combined
  ingress/runtime cold starts can leave time for database wake-up; exhausted
  startup deadlines return retryable `WORKSPACE_STARTING` within the existing
  bounds (#148).
- Storage recovery now delivers cleanup continuations through acknowledged
  SQS/Scheduler transport before marking them dispatched, rejects invalid
  dispatch configuration before opening the database, and retries failed
  continuation delivery without duplicating the obligation (#130).
- Removing an analysis dataset now persists an explicit empty state, prevents
  sample data from silently returning on the canvas or in Manage data, and
  supports undo/redo and selecting data again (#129).
- Dataset replacement now preserves saveable drafts with missing or incompatible
  fields, lists repair diagnostics, and names unresolved fields when export is
  blocked (#128).
- Horizontal bar charts keep their orientation in every small-multiples panel,
  with categories on the y-axis and reference lines on the value x-axis (#127).
- Pie slice limits now fold a retained category named "Other" into the Other
  bucket per facet, preserving totals and a single slice, tooltip and data-table
  row; genuinely duplicated source categories still fail validation (#126).
- Multi-measure small-multiples charts now resolve detailed tooltips and
  conditional-formatting rules against each series' own facet rows and
  measure, instead of indexing per-panel row groups by the global series
  index and showing or styling another panel's values (#125).
- Registered maintenance migrations create their durable receipt before reading
  it, so scoped S3 permissions and normalized errors no longer block the first
  write; retries preserve the original evidence and reject conflicts (#133).
- Duplicating an imported sheet now saves and autosaves successfully and exports
  an independent sheet with distinct visual, filter and interaction identities,
  while preserving the original sheet and imported-feature guards (#124).
- Dataset/query and analysis retry receipts now share configurable global and
  per-tenant entry/JSON-byte budgets, count retained analysis definitions and
  access snapshots, and expire during idle periods. Capacity failures return
  `IDEMPOTENCY_CAPACITY_EXCEEDED` without evicting retained retries (#121).
- Dataset/query retries (v1): idempotency keys now bind to request contents
  and version preconditions, reject mismatched retries with
  `IDEMPOTENCY_CONFLICT`, validate retry payloads before replay, and serialize
  concurrent requests sharing a retry key (#120).
- Source deletion guard (v1): deleting a source now checks the stored
  pipeline references of every prepared dataset — including unavailable
  datasets and references through join/append steps or an unavailable
  intermediate dataset — instead of only datasets that pass admission, and
  the check is revalidated against metadata revisions immediately before
  retirement so a stale check cannot retire a newly referenced source
  (#119).
- AI spend accounting: a charge now commits together with a durable warning
  intent, so an accounting or audit failure can no longer leave repeated
  provider calls unmetered past the tenant's cap; stranded warnings are
  retried and delivered exactly once after recovery (#138).

### Security

- Generative questions and calculated-field suggestions now reject permitted
  physical or calculated field names matching common PII patterns before any
  provider call, returning `AI_FIELD_NAME_PII` with rename guidance without
  echoing sensitive values (#139).
- Python SDK: the default urllib transport now rejects every HTTP redirect
  instead of following it, so the bearer token is never forwarded to a
  redirect destination (cross-origin or HTTPS→HTTP downgrade); this matches
  the TypeScript SDK, MCP and CLI transports (#118).
