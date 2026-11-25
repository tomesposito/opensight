# Issue #332 — connectable MCP

Implements the six ruled choices in [IDD D-95](idd/D-95-connectable-mcp.md).
The brief is the build contract; `SOLUTION_DESIGN.md` is unchanged. Checkpoint
commits stay on `work/issue-332-connectable-mcp`; no merge or push was performed.

## Items and acceptance evidence

1. `/api/mcp` serves the same 58 generated tools over stateless Streamable
   HTTP. The shared tool layer, schemas and v1 client remain authoritative.
   Read scopes hide and refuse mutations; query, search and ask POSTs are
   reads, while export-job creation requires write. Existing stdio behavior
   remains covered by its original suite.
2. The app supplies public-client registration, discovery, normal H2 sign-in,
   member/workspace consent, S256 PKCE, one-hour access, rotating refresh and
   revocation. Tests cover exact client/redirect/verifier binding, malformed
   requests, denied/narrowed scopes, replay and concurrent replay, expiration,
   browser-session binding, credential separation, membership removal,
   suspension, origin/key changes and process restart. Only credential hashes
   persist. Migration, runtime permissions, backup inventory, legacy upgrade
   and restore revocation include the four OAuth tables.
3. HTTP tools use the existing v1 handlers with the delegating member's
   credential. Root tests prove PII stop, CLS, private dataset and tenant
   isolation, current role changes, shared v1 rate/compute limits, managed AI
   spend cap before provider transport, and #330 action-history attribution.
   J10 defaults to HTTP plus dynamic OAuth; its stdio option remains available.
4. Account → MCP connections lists only the member's connections in the
   selected workspace and provides immediate revoke. Another member cannot
   revoke the grant; the next access and refresh both fail.

The local browser acceptance script
`packages/web/scripts/capture-mcp-connections.mjs` completed actual password
and TOTP sign-in, consent narrowed to read, PKCE exchange, a harmless read,
account revoke and failed access/refresh afterward. It intercepted the
synthetic connector callback locally and recorded **0 page errors / 0 external
requests**. Desktop (1280×800) and mobile (390×844) captures have no document
horizontal overflow. The official MCP SDK client also passes discovery and a
real dataset query against locally issued OAuth credentials.

## Visual comparison

The rebuilt static demo was recaptured against the same classic editor,
new-look editor and Q reference pairings, masks and pixel tolerance of 16.
Pixel differences are **41.22%**, **33.96%** and **45.30%**, respectively.
Each differs from issue #333 by less than 0.002 percentage points; existing
chrome/fixture gaps remain. These are pixel differences, not fidelity grades.
No new visual gap was identified. The new consent and connections screens
use the existing navy shell, Arial controls and mobile layout; no QuickSight
reference exists for the OAuth consent surface.

Feature screenshots `docs/images/mcp-consent.png` and
`docs/images/mcp-connections.png` use synthetic member/workspace data. Browser
artifacts are under `/tmp/issue-332-browser/`, and reference comparison reports
are under ignored `.opensight/issue-332/`. The static demo is a local artifact,
not a deployed server.

The README hero was regenerated from the rebuilt demo using the repository's
adaptation of the prescribed `readme-gif.mjs` storyboard and its ffmpeg
palette/assembly recipe: 262 frames, 10 fps, 960×600, 26.2 seconds. The tour
passed with **0 page errors / 0 external requests**. Its stale join step now
explicitly confirms the suggested key, and its MySQL assertion reflects the
already shipped selectable connector. These are capture-script repairs only.

## Verification

The full root `npm test` exited **0** after the cold-review fix pass:
**8,552 passed / 0 failed / 38 skipped / 0 cancelled** (8,590 tests).
This includes 13 additional regressions beyond the main build's 8,539 passes.
All 38 skips are live PostgreSQL integration cases: 36 in API and two in the
query engine, with `DATABASE_URL` or live TLS PostgreSQL not configured.
The Python SDK's 34 passing tests are included in these totals.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| api | 1,630 | 0 | 36 |
| bundle-parser | 213 | 0 | 0 |
| cli | 78 | 0 | 0 |
| embedding-sdk | 10 | 0 | 0 |
| headless-sdk | 33 | 0 | 0 |
| opensight-headless-sdk-python | 34 | 0 | 0 |
| mcp-server | 82 | 0 | 0 |
| o-interpreter | 42 | 0 | 0 |
| parity | 11 | 0 | 0 |
| query-engine | 2,704 | 0 | 2 |
| web | 3,595 | 0 | 0 |
| root-conformance | 120 | 0 | 0 |
| **Total** | **8,552** | **0** | **38** |

The completed command used
`OPENSIGHT_CHROMIUM=/home/hatch/workspace/tools/chromium-wrapper.sh npm test`.
That existing wrapper supplies the environment's required WebGL policy.
Local test servers and browser subprocesses ran with the execution permissions
they require. The completed fix-pass log is
`/tmp/issue-332-fix-pass-full-test.log`; parsed counts are retained in
ignored `.opensight/issue-332/fix-pass-root-test-counts.json`.

## Scope and handoff

- No new external dependencies, external requests, AWS calls, infrastructure
  application, new tools or CLI/SDK contract changes. The existing MCP build
  audits bundled dependencies as MIT/Apache-2.0. The generated edge validator
  was regenerated from shared ingress rules to admit the new exact paths.
- The brief requests an origin fetch, but the user forbids network beyond
  `npm install`. No fetch was made. Local `master` and `origin/master` both
  point to the brief's base `373ff0d41f031ade72cf20c2cc7bcb70218d857b`; the
  supervisor must fetch before merge/publish.
- Existing CloudFront configuration does not route `/.well-known/*` to the
  API. Tom must route the three exact discovery paths listed in
  [the deployment guide](connectable-mcp.md) during the normal hosted deploy.
  Infrastructure changes were excluded from this build.
- No live PostgreSQL service is configured. The separate Postgres persona
  journey was not run; root SQLite HTTP governance tests provide the local
  transport proof. Live Muse connector registration/consent/read proof belongs
  to Tom after deployment, as the brief specifies.
- The independent cold auth review completed with three findings, addressed
  below. The supervisor retains independent verification of these fixes and
  a full-suite run before merge; this builder's tests do not substitute for
  that verification.

## Cold review fix pass (2026-11-25)

The interrupted branch was clean at `45435df7`, with all six main-build
checkpoints present. The fix pass preserves those commits and addresses the
three findings in separate checkpoints:

1. `c0dd47d0`: bound credential replay revokes the family before scope
   validation. Regressions cover refresh and authorization-code replay after
   narrowing, including original, unknown and empty scope parameters, plus
   wrong-client, wrong-redirect and wrong-PKCE attempts that must not revoke.
2. `65fd8097`: OAuth uses separate durable budgets for bound connections,
   consent members and unauthenticated traffic. Twelve connections sharing
   one public client and IP complete exchanges, refresh and revocation without
   spending interactive-auth budgets. Tests also cover rotation/restart,
   window recovery, unknown credentials, independent revocation, and family
   revocation even when the token budget is exhausted.
3. `a77a6c0b`: unsupported large MCP results return `MCP_RESULT_TOO_LARGE`
   with `isError: true`. The production serverless publisher refuses them
   before chunk storage, and the bridge rejects descriptors and oversized
   inline responses. A real dashboard query exceeding 1 MiB traverses OAuth,
   MCP and invocation-mode v1 routing; only external chunk storage is stubbed.
   Browser chunk publication, the exact size boundary, UTF-8 byte accounting,
   authority rechecks and the bridge envelope limit are covered as well.

The targeted OAuth regressions passed **21 / 0 / 0** and the large-result
regressions passed **2 / 0 / 0** (passed / failed / skipped). The existing
interactive-auth suite also passed all nine tests during the fix pass.
There are no UI changes, new dependencies, AWS calls or deployments in these
fixes. The prior UI captures remain applicable; the supervisor retains the
demo rebuild, independent full-suite verification, merge and publish steps.
