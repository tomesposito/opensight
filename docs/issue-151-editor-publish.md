# Hosted editor publication and reader dashboards — issue #151

Hosted authors use **Save analysis** to persist the working definition through
`POST /api/v1/analyses` or revision-checked `PUT /api/v1/analyses/{id}`.
**PUBLISH** saves that definition and calls the existing v1 publish operation.
The editor reports progress, the returned dashboard ID/version, publication
diagnostics, or the server's named error. Repeat publication updates the same
dashboard. No API route, dependency, AWS call, or deployment was added.

The device recovery draft remains separate. Autosave and Save as Analysis copies
still retain device drafts; explicit Save analysis and PUBLISH write hosted
assets. Hosted asset/revision receipts are scoped to the device draft and its
workspace/principal. Analysis saves use revision-specific idempotency keys;
ambiguous publish retries reuse their saved version and idempotency key before
accepting further hosted saves. A failed or stale write never reports success.
Local and demo workspaces retain their device-local/no-publication notices.

## Home, collection and reader view

Hosted Home and **My stuff → Dashboards** list the current principal's accessible
published dashboards, following the v1 collection's Cursor header. Loading and
request failure are distinct from a successful empty collection. All hosted
roles start without synthetic charts. The local sample opt-in and demo showcase
are unchanged.

`#/dashboards/{id}` opens the latest published definition, pins its version for
visual queries, and renders live rows through the visual compiler. Refresh
reloads the current published version. Sheet selection and supported parameter
controls are read-only interactions: requests contain frozen control IDs and
typed values, never caller-supplied predicates. Changing controls clears prior
results while new queries run. Query errors never fall back to fixture data.

The shared planner accepts the editor's presentation properties and binds its
category, numeric equality and inclusive numeric/datetime parameter filters to
the existing typed predicate path. Unknown query semantics remain errors.
The reader supports authored static dropdowns, sliders, dates and text controls.
Linked dataset option discovery and imported filter controls display explicit
limitations; they do not silently query arbitrary reader data. Existing
unsupported visual kinds/actions retain execution diagnostics.

AI-capable roles get Ask O scoped to this dashboard. It uses the established
400px dock and content-width card stacking; at mobile widths it stays in document
flow. No provider means the existing unconfigured-provider notice and disabled
generative toggle. No sample schema or rows are substituted on this surface.

## Access boundary retained

Administrators can use **Dashboard access** on a published dashboard to grant a
registered workspace user viewer access through the existing, revision-checked
share route. A publish does not automatically grant visibility to other users.
Non-administrators still require an administrator to manage grants.

[D-53](idd/D-53-dashboard-reader-share-access.md) and HQ-4 remain authoritative:
a dashboard grant authorizes the definition, not the publisher's prepared data.
A different reader gets `DASHBOARD_DATASET_ACCESS_DENIED` for those live queries.
J4 now opens the real Orders dashboard and measures its controls/docking, but
records that data/filter gap explicitly. Completing that cross-owner data
journey requires Tom's separate reader-data/delegation decision and security
proof; this change does not introduce delegation.

## Verification and visual review

Client, component, shared-planner and real hosted HTTP integration tests are
included in root `npm test`. J2 asserts an empty hosted home; J4 publishes through
the editor, grants definition access through the administrator UI, opens the
reader collection, submits a real control query, and measures dock geometry.
The complete persona suite also preserves J3's honest local publication gap.

The static demo was rebuilt. Chromium captures of the prior and rebuilt Home at
1440×1100 produced identical 1440×1431 images (zero changed pixels, four SVG
charts). No demo-visible UI changed, so README screenshots and the hero GIF were
not regenerated. This is a static artifact, not a deployed server. Hosted visual
review uses the persona screenshots; visual fidelity against QuickSight remains
unmeasured.
