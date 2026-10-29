# Published prepared dashboards: share-the-recipe (#155)

Implements the product owner's [D-85 decision of 2026-10-28](idd/D-85-share-the-recipe.md).
A hosted dashboard grant permits reading its definition. A reader query or
export also needs independently authorized sources for every input of the
publisher's saved recipe. Source IDs resolve under the reader's tenant,
namespace and user; this slice adds no source-sharing or credential-delegation API.

The durable published version selects the publisher's recipe. Nested dataset
references keep that recipe owner; same-ID reader recipes cannot replace them.
The graph traversal checks all source inputs, including joins, append steps,
nested datasets and unused branches. Reader row policies and tenant predicates
filter leaf tables before preparation; denied columns are removed from the
recipe schema. Recipes requiring those columns fail closed. Cyclic, invalid or
unsupported recipes also return `DASHBOARD_DATASET_ACCESS_DENIED` (403).

The entire reader recipe executes fresh in bounded request-local memory,
including joins and aggregates otherwise configured for Blaze. Neither root
nor nested prepared caches are read or written. Uploaded source payloads are
read only through the reader's source/secret/artifact binding. No publisher
payload, prepared artifact, sample fallback or partial result is returned.
Admission and publication retain revision, source activity and request checks;
revocation blocks fresh reads and idempotent query/export replay. Policy changes
also require a fresh bearer session under the existing authentication rules.

Owner prep authoring, execution settings and cache behavior are unchanged.
`LocalDashboards` uses the separate `PrepRoutes`/`BlazeStore` identity and
storage model, so its owner check remains intact. `job-renderer.ts` and
`embed-content.ts` keep all existing owner/single-source denials. Legacy hosted
dataset bindings are unchanged. No dependencies, AWS calls, deployment,
push, merge or changes to the solution design/architecture register are included.

`packages/api/test/reader-prepared-dashboards.test.mjs` exercises real metadata,
source admission, bounded workers and the prep executor: different owner/reader
rows, nested joins and aggregates, missing inputs, unused branches, RLS/CLS,
owner-populated root/nested caches, mid-execution and subsequent revocation,
tenant ID collisions, forged contexts/versions and unsupported recipe shapes.
`v1-dashboards.test.mjs` additionally proves HTTP query/export behavior, reader
roles, owner/reader idempotency-key isolation, forbidden override fields and
revocation on replay. Both are included by root `npm test`.

J4's existing reader-filter journey now explicitly verifies denial without
source authorization and successful filtering after independent source access.
Its trusted fixture provisions a separate reader source and changes its policy;
the dashboard grant itself never changes dataset permissions. The supervisor
runs the persona suite separately. No editor layout or static-demo UI changed.

## Changed files

| Area | Files |
| --- | --- |
| Reader execution | `packages/api/src/hosted-dashboards.ts`, `packages/api/src/hosted-prep.ts`, `packages/api/src/metadata.ts` |
| Security proof | `packages/api/test/reader-prepared-dashboards.test.mjs`, `packages/api/test/v1-dashboards.test.mjs` |
| Persona expectations | `packages/web/scripts/persona-journeys/j4-reader-daily.mjs`, `packages/web/scripts/persona-journeys/README.md` |
| Documentation | This guide, `docs/headless-v1-dashboards.md`, `docs/idd/D-85-share-the-recipe.md`, `CHANGELOG.md` |

## Verification

The full root `npm test` ran with `TZ=UTC` and the supplied local Postgres
`DATABASE_URL`, exiting **0**: **4,365 passed / 0 failed / 1 skipped**,
with no cancellations or TODOs. This includes **4,333 Node tests** and all
**32 Python SDK tests** (`unittest`: `OK`). The API workspace passed **886**
tests, including all **9** new issue #155 tests; the query engine passed **523**.

Every integration test enabled by `DATABASE_URL` ran, including forced tenant
RLS, source execution and branched-prep Postgres comparisons. The only skip is
the existing real-TLS Postgres storage CLI test because
`OPENSIGHT_TEST_POSTGRES_CA` is not configured. J4 passed `node --check`;
its full persona execution remains with the supervisor as requested.

## Static demo and gap notes

`npm run build:demo --workspace=@opensight/web` succeeded. Chromium captures
before and after rebuilding are identical at **1440 × 1000: zero changed
pixels**, with four SVG charts, no page errors and no external requests.
Captures are in `.opensight/issue-155/demo-before.png` and `demo-after.png`.
The sample-dashboard reference matches the chart layout and values; its older
navigation and branding differ from both captures and predate this slice.
No new visual gap was introduced, so README screenshots and the hero GIF were
not regenerated. This is a static demo, not a deployed hosted server, and
QuickSight visual fidelity remains unmeasured.
