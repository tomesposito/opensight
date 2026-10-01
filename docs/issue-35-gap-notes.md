# Issue #35: P2 polish

Branch `work/issue-35-p2-polish` starts at published master `a91cd789`.
The reboot left no completed issue checkpoints and one baseline browser script.
All six items were inspected against that unchanged starting point. The run
brief is the polish contract; `SOLUTION_DESIGN.md` remains unchanged.

## Baseline audit

1. Author rendered two JSON export buttons and two .qs download buttons when
   File was open. Confirmed in Chromium against the actual local API and Vite.
2. Definition previews displayed the circular `◌` loading-like symbol even
   when settled. The symbol had no CSS animation, but conveyed waiting.
3. Local uploads/prep already work through #29; #33 routes local deterministic
   O through dataset queries. `/api/o/*` remains reserved for hosted O. The
   fixture-only library API and the default CLI local workspace are distinct.
4. `Definition explorer` is absent from `packages/web/src`; the browser header
   reads OpenSight, product navigation and the current page title after #31.
5. TotalDeathByCountry has no attached rows. Local preview already hides O;
   offline preview still showed O while silently answering against sales.
   A browser question returned synthetic East 500 / West 400 under that heading.
6. First-run local Author showed `No successful refresh recorded`. #32 replaced
   the old restore path in Author, but unreadable legacy storage could still
   expose validation/JSON diagnostics. Source recovery already supplies retry,
   re-upload and reconnect controls and must retain them.

## Checkpoints

- **1 — Fixed:** File is the single home for Export JSON and Download .qs.
  Their existing handlers, disabled states and export explanation remain.
  Author and bundle UI tests: 15 passed, 0 failed, 0 skipped. The browser
  acceptance script checks DOM counts and real downloads in local/static modes.
- **2 — Fixed:** Only pending queries render the circular loading symbol.
  Missing data, empty results, definition previews and query failures remain
  settled text states. Focused empty-state tests: 12 passed / 0 failed / 0 skipped.
  Browser checks also require no active animations in settled definition cards.
- **3 — Already fixed by #29/#33, verified:** No auth/runtime changes. The
  endpoint matrix covers both queries, O query/generate, upload creation/read,
  prep source/dataset lists, prep GET/PUT/DELETE/preview, execution GET/PUT,
  cached rows and refresh. Forged identity headers fail on every route; adding
  a bearer string cannot turn a local request into a hosted identity.

## Access rules verified for item 3

| Surface | Local workspace (default fixture CLI) | Fixture-only library API (`localData: false`) | Static/explicit sample demo | Hosted API |
| --- | --- | --- | --- | --- |
| Sales dataset query | Public synthetic rows, HTTP 200 | Public synthetic rows, HTTP 200 | Computes bundled rows; no API | Verified session, tenant dataset and existing grants required |
| Prepared dataset query | Actual local upload/pipeline; no sign-in | No prepared registry; HTTP 404 | Unavailable; no API | Verified session and existing source/grant checks |
| Deterministic O | Uses the same dataset query as Author (#33) | Sample UI runs locally | Computes synthetic sales, labeled offline | Uses gated `/api/o/query`; no fallback |
| `/api/o/query`, `/api/o/generate` | HTTP 503 `SECURITY_NOT_CONFIGURED` | Same | Never called | HTTP 401 without verified tenant session; existing AI gates still apply |
| Uploads and all prep routes | Explicit single-user local access (#29), actual upload/preview/save/query/Blaze/refresh | HTTP 503 `SECURITY_NOT_CONFIGURED` | Disabled with API prerequisite | HTTP 401 without verified tenant session, then existing role/ownership/grant checks |

The default CLI's `OPENSIGHT_MODE=fixture` enables the local workspace. The
library's fixture-only mode intentionally exposes public fixture queries but
no upload/prep workspace. `/api/o/*` is a hosted capability, not the transport
for local deterministic interpretation. These are capability boundaries, not
a general “all writes need auth” rule: local workspace writes are explicit.
No route was opened and no hosted error was replaced by sample data. Existing
hosted source, role, RLS/CLS and ownership suites remain part of mandatory tests.

## Remaining checkpoints

- **4 — Already fixed by #31, verified:** Header regression asserts OpenSight,
  product links and page captions in local, demo and hosted Author access.
  Navigation tests: 19 passed / 0 failed / 0 skipped. Browser acceptance checks
  the actual Author caption and absence of the old phrase in both render modes.
  No product/header implementation change.
- **5 — Changed:** Definition previews hide O in every mode and link to Home
  for sample sales questions. Home and Author retain their existing O routing;
  hosted published dashboards retain their existing dashboard and AI gates.
  Regressions cover all bundled fixtures plus the sample and hosted exceptions.
  The browser follows the Home link and checks actual offline East 500 / West 400.
- **6 — Fixed:** A direct-query dataset with no refresh history omits the idle
  diagnostic. Real refresh timestamps, running state and named failures remain.
  An empty Blaze cache says **Choose Refresh Blaze to prepare data for your
  charts**; an active refresh says **Preparing cached data…**. Unreadable saved
  analyses explain reload/import recovery and preserve the stored value, including
  malformed legacy JSON. Existing source retry/re-upload/reconnect controls remain.
  Focused refresh, authoring and draft tests: 69 passed / 0 failed / 0 skipped.
