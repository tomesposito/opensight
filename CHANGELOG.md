# Changelog

All notable changes to OpenSight are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

No numbered release has been cut yet, so every shipped change so far sits
under Unreleased. When the first release is cut, the release flow moves the
Unreleased entries into a new version section (see AGENTS.md §1).

## [Unreleased]

### Added

- Terms of Service and Privacy Policy published as site pages at `/legal/terms/` and `/legal/privacy/`, linked from every site footer (and from the signup page's terms line) and listed in the sitemap; the pricing page and the open-economics doc no longer promise an SLA (#210).

- Dependabot configuration covering the npm workspaces and the SHA-pinned GitHub Actions on a weekly schedule, opening labeled update PRs against the triage bar in `docs/dependency-triage.md` (#111).

- An operator Signups panel with trial funnel counts, durable pause/resume, a rolling volume cap and verified queue, plus retention-due entry points into existing D-84 erasure; billing/mail/signup state participates in erasure and encrypted backups (#197).

- An unlinked hosted signup page, session trial countdown, administrator tier checkout and paused-workspace payment/export/closure screens; stored `free` values display as Self-hosted in tier labels (#197).

- Dark-by-default self-serve signup with email verification, existing idempotent provisioning, provider-aware email normalization, disposable-domain filtering, server-verified bot challenges and durable public rate limits (#197).

- Tenant outbound mail now enforces 25 recipients over a trial and D-82 paid monthly allowances across invitations, reports, digests and alerts; operator mail is excluded (#197).

- Hosted 14-day trial billing state, server-clock expiry and 30-day paused retention; payment, export and closure replace the drop-to-Free resolution (#197).

- Ask O dashboard generation with a staged canvas, editable tiles and one-step sheet commit; conversational revision of stamped O tiles preserves presentation and custom titles. Managed credits charge per delivered tile or revision proposal (#196).

- Hosted operator provisioning pages for tenant lists, creation, billing links, inline usage, invitations and lifecycle management; separate required workspace display names from namespace names with validated unique slugs (#192).

- Hosted generative Ask O with deployment-managed Bedrock and monthly usage credits, tenant-admin BYO AI settings with encrypted write-only keys, reader-scoped grounded result visuals, and a clear credit-limit fallback to the standard interpreter (#190).

- SQL notebooks on the local/organization API: author markdown, SQL and shared-compiler visuals, publish parameterized apps that run with each viewer’s data permissions, and save private dataset snapshots with visible as-of times. Includes named SQL/security errors and run history; hosted notebooks and dashboard snapshot consumption remain follow-ons (#164).

- Shared metric digest lists: owners/admins choose workspace members, receive one message per period computed from their intersected row and column access, preview withheld/empty results, and stop the whole list with one-click unsubscribe. Removed or de-authorized recipients are dropped at delivery (#162).

- Governed metric email digests: self-subscribe weekly or daily, compare completed periods, inspect deterministic dimension changes, drill back into the metric, and unsubscribe in one click. Hosted delivery rechecks recipient permissions and deduplicates each subscription/period. (#162).

- Stripe billing for the hosted tiers: the operator can generate a Stripe-hosted payment link for a tenant's tier (Light $29/mo, Regular $99/mo, Heavy $399/mo), and a signature-verified webhook applies subscription state to the tenant's entitlement tier exactly once, with every change in the operator audit trail. Past-due subscriptions pause the tenant's hosted access after Stripe's retries run out — data retained, no automatic downgrade — until an admin pays in Stripe or explicitly drops the tenant to Free. Billing is disabled unless the full Stripe configuration is present in the environment; no card data ever touches OpenSight (#194).

- Four competitor pages on the marketing site in the copy approved for the issue: Tableau and Power BI alternatives pages at /alternatives/tableau and /alternatives/power-bi (per-seat maths from the vendors' published prices, what does not convert, and where each incumbent is the better choice), and versus pages at /vs/metabase and /vs/superset (licence and permissions lines, and where Metabase and Superset are stronger today). Every competitor fact is cited to the vendor's published page, the home-page footer links all four, each page cross-links the other three, and all four are listed in the sitemap (#187).

- A QuickSight alternatives page on the marketing site at /alternatives/quicksight and a migration guide in the docs at /docs/migrating-from-quicksight: what converts on bundle import, what must be rebuilt by hand, and where QuickSight is the better choice, in the copy approved for the issue. The home page's QuickSight section links the alternatives page, and both pages are listed in the sitemap (#186).

- A pricing page on the marketing site at /pricing: OpenSight is free to self-host, and the hosted tiers (Free, Light $29/mo, Regular $99/mo, Heavy $399/mo) differ in quotas, not features, with a worked 20-person cost comparison against Tableau and Power BI from the vendors' published prices. Linked from the home-page nav and listed in the sitemap (#184).

- Governed input tables (writeback v1): a workspace can create OpenSight-owned tables with typed columns (text/number/date/boolean, required or optional), edit them in a grid on the Data page, and join them in data prep like uploaded datasets. Sources are never mutated; editing needs an explicit per-table editor grant plus an author-class role (readers never write), and every change lands in an append-only audit trail that survives table deletion (#161).

- The open-economics rule is published as a docs page: core governance — single sign-on, row-level security, the audit log, and basic embedding — stays in the open product and is never paywalled; paid tiers buy quotas, support, and an SLA. A guard test fails the suite if a published page puts one of the four behind a paid or enterprise tier, and D-77 carries an update recording that its "future enterprise lever" note no longer applies to them (#165).

- Hosted entitlements can now hard-cap egress: an optional monthly `egressBytes` limit counts actual hosted tenant API response bytes and refuses further requests with `USAGE_LIMIT_EXCEEDED` once the cap is reached, instead of only metering egress (#193).

- Indexable documentation pages for local setup, connectors, embedding and shipped
  permissions/row-level security, generated from repository Markdown with freshness
  checks, a docs index, site navigation and sitemap entries (#185).

- Marketing site head now carries a canonical link, the share image's true dimensions (2400x1260) and alt text, and a SoftwareApplication JSON-LD block, so search and AI tools can identify OpenSight cleanly (#183).

- Usage tracking now records the marketing capture events: `data_source_connected` on a live (PostgreSQL) source registration, `dashboard_saved` (with a workspace-first flag) on dashboard publish, and `dashboard_edited` on republish — tenant-level, counts and flags only, so activation and week-4 retention can be computed (#179).

- Hosted workspace members can privately suggest Ideas, follow review status and see decline reasons or shipped references; operators review submissions in a human-controlled queue (#178).

- Request hosted access from the marketing site, with validated capture and a private operator review list for manually provisioned workspaces (#176).

- Hosted access requests can now email the operator when a request lands: set `OPENSIGHT_ACCESS_REQUEST_NOTIFY_TO` and configure SMTP, and each stored request notifies that address. A mail failure never blocks a submission, and unnotified requests stay visible in the operator list and retry on later submissions (#177).

- The GitHub README now links to [getopensight.org](https://getopensight.org), so anyone who finds the repo can reach the marketing site and the hosted option.

- Marketing site: the favicon URL is versioned and an apple-touch-icon is declared, so browsers pick up the current brand mark instead of a cached one.

- Promote saved dataset calculations into draft governed metrics with source provenance, and share prep recipes as versioned templates with owner approval and explicit input binding (#160).

- Dataset-bound governed metrics with versioned definitions, editor drafts, owner/admin
  approval, audit/export, and shared follow-latest consumption in analyses,
  dashboards and Ask O; unsafe join fan-out fails closed (#157).

- Caller-declared SUM/COUNT aggregate tables and opt-in live-query result caching
  with per-dataset TTL and manual invalidation; visual cards identify cached and
  aggregate results (#159).
- Ask O answers are grounded and inspectable: every answer names the defined
  fields it used, any field synonyms it matched (declared in dataset field
  metadata, e.g. "sales" for revenue), and any question terms it did not
  understand; the interpretation is shown as editable steps (aggregation,
  group-by, filters, Top N, granularity, visual type) that re-run the normal
  preview and add-to-analysis path when changed (#158).
- Spreadsheet-style data-prep previews with numbered rows, typed column headers,
  and formula, filter, and rename shortcuts that create ordinary validated
  preparation steps (#156).
- Deterministic field search in Create Analysis, with keyboard-accessible field
  suggestions, explicit unknown/ambiguous-token errors, and normal editable
  KPI or bar analyses from a measure optionally grouped by a dimension (#156).
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

- The whole app palette moved to the approved brand colors: brand-blue
  accents and slate borders, tints, and ink replace the pre-brand
  teal/blue-gray system across home, analyses, the editor, data,
  admin, first-run, and embed surfaces. Editor layout and typography
  are unchanged; data-viz theme palettes and semantic colors stay
  as they were (#167).
- Sign-in and invitation enrollment screens restyled to the approved
  brand design (navy page with the brand glow, white card, brand-accent
  actions, Inter), replacing the pre-brand teal styling (#166).
- The brand mark was redrawn to match the approved brand sheets: four
  filled sparkle arms with a four-point star center hole replace the
  earlier ring-arc rendering, across the app header mark, favicons,
  touch icon, marketing site, and the link-preview share card.
- Link previews for getopensight.org now use a designed marketing share
  card (`site/assets/og-image.jpg`, 1200×630) as the og:image and
  twitter:image, replacing the hero video poster frame.
- The question side panel is branded "Ask O" (trigger mark "O", heading
  "ASK O") and docks into the layout — the shell reserves its width instead
  of the panel overlaying the canvas (#135, #136).
- Editor polish passes: an exhaustive interactive audit of the app
  (866 elements, 637 unique surfaces, light and dark) drove a long run of
  hover and paint fixes; the final re-audit came back empty and the polish
  bucket closed (#108).

### Fixed

- Input-table audit history now retains the newest 1,000 entries per table and 10,000 overall, with optional pagination; single-table and audit reads clone only the requested slices. Legacy stores still load and retained row details remain intact (#220).

- Concurrent input-table cell edits preserve each other's changes and record accurate audit values. Optional version checks reject stale saves, and the row editor uses them to prevent overwriting newer table data (#219).

- The open-economics guard (#165) now exercises executable checks instead of prose alone: behavior tests prove row-level security, the audit log, basic embedding and the identity verifier seam work under every billing tier's entitlement, the entitlement parsers reject governance feature-flag fields, and the site guard scans every published site page, pricing and comparison pages included (#215).

- Hosted egress caps reserve the remaining allowance before sending a response, preventing concurrent requests from multiplying the permitted single-response overshoot. Failed accounting retains the reservation so later requests remain denied (#214).

- Existing hosted tenants keep their configured quotas and billing tier limits enforced when self-serve signup is disabled (#213).

- A trial workspace no longer converts to paid entitlements before payment succeeds: an unpaid checkout or an incomplete subscription now binds and is recorded without assigning the paid tier or clearing the trial expiry, and conversion happens only on a verified paid checkout or an active subscription (#212).

- Delayed Stripe events can no longer restore canceled access, undo tier upgrades, or replace the current subscription through unrelated subscription updates or invoices. Billing now checks event creation order and subscription bindings atomically, and ignores unlisted event types (#211).

- Reject unsupported API paths before scanning large browser headers at the edge, avoiding a CloudFront regex-limit failure during release validation (#199).

- Include the social preview image and all approved pricing, comparison, documentation and dark signup pages in the attested marketing archive, with explicit public routes and reference checks (#183, #184, #185, #186, #187, #197).

- Durable job deliveries (digests, reports, alerts) that fail with a load cancellation — execution-budget `EXECUTION_CANCELLED` or queue-wait `QUEUE_WAIT_EXCEEDED` — now retry with the existing durable backoff instead of being cancelled permanently, keeping delivery at-least-once as decided in HQ-13 (#199).

- Imported visuals' tooltip field references no longer leak foreign QuickSight field IDs into live queries after remap; unresolvable tooltip references stay retained/read-only for export (#195).

- Imported visuals whose only issues are retained, read-only properties now render once remapped to a local dataset with their wells assigned: the retained properties stay named in the import report and are preserved verbatim on export, but are not executed. Unsupported visual types, filter-group and calculated-field issues, and compile errors still block rendering (#191).

- Serverless responses complete after persisting opt-in analytics events, without waiting for PostHog delivery; a durable outbox retries pending copies while respecting tenant opt-out (#175).

- Live-result cache invalidation is now a freshness boundary for in-flight
  queries: a query that missed before invalidation (including a local refresh)
  still returns its rows to its caller but cannot repopulate the cache or
  overwrite a newer cached result (#174).

- Bound opt-in live-query result caches by total and per-result serialized bytes;
  oversized SQL results still return normally, and insertion purges expired
  entries to release their retained bytes (#173).

- Include the marketing site's Apple touch icon in the attested release archive so home-screen bookmarks can load the declared image (#176).

- Hosted governed-metric queries and vocabulary lookups read only their bound
  dataset, metrics and required prep dependencies; unrelated workspace history
  no longer expands the metadata read, and repeated definition bindings share
  one lookup per dataset (#172).

- Ask O grounding now names the governed-metric version that actually executed: the executed versions arrive with the query response and replace the interpretation-time label, which stays visible separately as "Interpreted against" when a publication landed in between (#171).

- Hosted workspace sessions stay signed in when governed metrics or preparation templates are saved or published, including unpublished drafts; stale content work still fails closed (#170).

- Hosted governed-metric listing now honors the exact dataset the browser selected: the serverless ingress validates and forwards the `Metric-Dataset` reference instead of dropping it, so legacy datasets and other owners' prepared datasets no longer fall back to the caller's own prepared dataset; malformed references fail closed at ingress (#169).

- Governed metrics with a DISTINCT_COUNT default aggregation now run in analyses, dashboards and Ask O instead of failing in the shared query planner; distinct counts ignore duplicates and nulls and work on text as well as numeric fields (#168).

- Serverless owner upgrades now admit governed metrics and recipe templates on existing databases while preserving resources, links and ownership constraints (#157, #160).

- Precompile the shared serverless route patterns for CloudFront and bypass v1
  matching for ordinary API requests, preventing edge CPU throttling during
  uploads and hosted authoring (#150, #151; D-86).
- Hosted invitations, analysis saves, publishing, sharing and reader dashboards
  now cross the serverless ingress boundary. Retries and rate limits survive
  Lambda changes, publication receipts commit with metadata, and invitation
  email uses the existing worker queue without exposing SMTP credentials to
  request execution (#150, #151, #152, #155; D-86).
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
- AI spend accounting (reopen): a failure of the warning-intent store itself
  no longer rolls back the charge either — the intent attempt is savepoint-
  guarded inside the charge transaction, so recorded usage still advances to
  the cap and later provider calls stay bounded while the warning store is
  unavailable (#138).

### Security

- XLSX uploads now validate actual ZIP inflation before spreadsheet parsing,
  enforcing the 16 MiB member and 64 MiB total limits even when headers lie;
  contradictory local/central metadata, data descriptors and ZIP64 overrides
  fail closed (#221).
- Input-table mutations now recheck the caller's editor/manager authorization
  inside the serialized store change, against the current table and current
  role: an editor whose grant is revoked while their request body is in
  flight, or while the write is queued, can no longer commit a row add,
  patch, delete, rename, editor change, or table deletion (#218).
- Managed-AI connection tests in the admin AI settings now pass the same
  pre-call spend gate as answers and record their provider tokens in the
  spend ledger (still zero delivered-answer credits), so repeated tests can
  no longer run past the daily spend cap or hide their operator cost (#217).
- The dark-by-default signup flag is now enforced on the namespace-scoped
  checkout route as well as the literal one: with signup disabled, an
  authenticated administrator can no longer create a Stripe checkout session
  through `/api/namespaces/<ns>/signup/checkout`; billing state stays
  readable with `checkoutEnabled: false` (#216).
- XLSX uploads are now rejected before parsing when the workbook's declared
  uncompressed ZIP sizes exceed the ceilings (16 MiB per member, 64 MiB
  total, 1000 members), so a small high-ratio file can no longer inflate
  unboundedly inside the API process during the SheetJS parse (#182).
- Governed-metric synonyms no longer bypass the generative-AI PII egress
  guard: both Ask O routes check synonyms with field names and return
  `AI_FIELD_NAME_PII` before any provider call, and metric validation rejects
  PII-shaped synonyms so new ones cannot be stored or published (#181).
- Ask O and planner-backed queries now report CLS-denied columns exactly like
  missing columns, preventing error responses from revealing denied-column
  existence while continuing to reject access (#180).

- Generative questions and calculated-field suggestions now reject permitted
  physical or calculated field names matching common PII patterns before any
  provider call, returning `AI_FIELD_NAME_PII` with rename guidance without
  echoing sensitive values (#139).
- Python SDK: the default urllib transport now rejects every HTTP redirect
  instead of following it, so the bearer token is never forwarded to a
  redirect destination (cross-origin or HTTPS→HTTP downgrade); this matches
  the TypeScript SDK, MCP and CLI transports (#118).
