# Issue #190 — hosted generative Ask O

The hosted single-node server and serverless invocation composition now expose
Ask O status, generation, calculation and result queries, plus tenant-admin AI
settings, encrypted key replacement and connection testing. Both forms share
the existing O prompt, PII guard, grammar and expression validation. Reader AI
questions require an accessible published dashboard and run against the reader's
authorized data; calculation suggestions also require build capability.

## Configuration and semantics

Deployment-managed Bedrock is enabled by `OPENSIGHT_AI_MANAGED=bedrock`,
`OPENSIGHT_AI_BEDROCK_MODEL` and `AWS_REGION`. It uses the deployment's standard
AWS credential chain and a bounded, SigV4-signed Converse request. No credentials
are stored in tenant settings. Managed is the default when enabled; admins can
select BYO or off. Bedrock cannot be selected as a tenant BYO provider.

BYO settings reuse the existing `ai-config/provider` and `secret/ai-provider`
metadata resources and tenant/namespace-bound AAD v2 encryption. The API exposes
only `hasKey`; provider/endpoint changes invalidate the old key binding.
OpenAI-compatible endpoints require the existing deployment allowlist.

Managed mode also requires `aiCallsPerMonth` in the entitlement. D-82 allowances
are Free 10, Light 50, Regular 500 and Heavy 3000. An absent allowance disables
managed AI for the tenant. The field is validated through both ordinary and
billing tier entitlement configuration. UTC daily usage rows provide the monthly
credit total, and current-month AI rows survive short retention settings.

The meter checks monthly credits and the existing daily spend cap before the
provider call. It commits one credit only after answer validation and scope
rechecking, with an atomic monthly-limit recheck for concurrent completions.
Provider failures, unsupported/invalid responses, security or quota denials,
BYO calls and admin connection tests consume no managed credits. Exhaustion
disables generative mode while the standard interpreter remains available.

See [hosted configuration](hosted-single-node.md#hosted-generative-ask-o-190)
and [budget containment](h4-budgets-containment.md#hosted-ask-o-190) for deployment
details. The static demo remains a local fixture preview, not a deployed server.

## Verification

The final full root `npm test` run exited zero: **4,741 passed / 0 failed /
36 skipped**, comprising 4,709 passing Node tests and 32 passing Python SDK
tests. All 36 skips require live PostgreSQL (34 API and two query-engine cases).
There were no cancellations or TODOs.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| api | 1,061 | 0 | 34 |
| bundle-parser | 199 | 0 | 0 |
| cli | 73 | 0 | 0 |
| embedding-sdk | 10 | 0 | 0 |
| headless-sdk | 28 | 0 | 0 |
| mcp-server | 74 | 0 | 0 |
| o-interpreter | 42 | 0 | 0 |
| parity | 11 | 0 | 0 |
| query-engine | 597 | 0 | 2 |
| web | 2,512 | 0 | 0 |
| root conformance/docs | 102 | 0 | 0 |
| Python SDK | 32 | 0 | 0 |

The root command is `npm test`, with `TMPDIR=/tmp` and `OPENSIGHT_CHROMIUM`
pointing to the installed headless Chromium shell. Local HTTP and worker tests
run with socket/process permissions. The final log is
`/tmp/issue-190-npm-test.log`; exact package totals are retained in
`/tmp/issue-190-test-counts.json`.

The J4 reader journey passed **14 steps / 0 failed / 0 gaps**. Its
`ai-answer-environment` step requires a real generated interpretation and reader
query result (east 40 / west 20), a rendered chart, grounding and a one-credit
debit. The exhausted-credit step confirms that standard questions still render.
The runner now rejects an environment gap in place of the required AI answer.
There were no browser errors, external requests or transport errors.

A focused admin browser check passed both its settings and browser-health steps,
including a managed connection test with zero credit consumption. The last
focused API/retention run passed **11 / 0 / 0**. The focused generative UI run
passed **9 / 0 / 0**, including the legacy single-node request shape, hosted
dataset scope for questions and calculation suggestions, and standard answers
after an admin turns AI off. Browser evidence is linked in
[the visual review](issue-190-gap-notes.md). The demo was rebuilt, and the README
hero GIF and relevant hosted feature screenshots were refreshed.

## Scope boundaries

All brief items A–G are implemented. No new dependencies were needed. Bedrock
transport is exercised only through injected fake fetchers; there were no live
model calls, AWS spending, deployment, push or merge. Production credentials and
live Bedrock availability therefore remain operator validation work.

The deterministic provider requires `NODE_ENV=test`,
`OPENSIGHT_AI_MANAGED=stub` and `OPENSIGHT_AI_TEST_STUB=1`. Production configuration
rejects it. J4 uses this provider through the real hosted API and real local
PostgreSQL fixtures. Existing single-node provider-success metering behavior is
preserved for compatibility; the delivered-answer contract applies to the new
hosted path, as specified in the brief.

`SOLUTION_DESIGN.md` was not edited. Work is checkpointed only on
`work/issue-190-hosted-generative`.

## Files changed

46 files differ from the starting branch revision (`bd0563dc`):

```text
CHANGELOG.md
README.md
docs/h4-budgets-containment.md
docs/hosted-single-node.md
docs/images/ai-provider-settings.png
docs/images/ask-o-credit-limit.png
docs/images/ask-o-managed.png
docs/images/opensight-tour.gif
docs/issue-190-gap-notes.md
docs/issue-190-hosted-generative.md
ops/serverless/edge-viewer.js
ops/serverless/modules/edge/edge-viewer.js
packages/api/src/ai-bedrock.ts
packages/api/src/ai-providers.ts
packages/api/src/ai-settings.ts
packages/api/src/hosted-ai-settings.ts
packages/api/src/hosted-ai.ts
packages/api/src/hosted-dashboards.ts
packages/api/src/hosted-prep.ts
packages/api/src/hosted-server.ts
packages/api/src/hosted-usage.ts
packages/api/src/metadata-resources.ts
packages/api/src/o-generative.ts
packages/api/src/runtime-ingress.ts
packages/api/src/serverless-application.ts
packages/api/src/single-node-maintenance.ts
packages/api/test/ai-bedrock.test.mjs
packages/api/test/ai-credits.test.mjs
packages/api/test/hosted-ai.test.mjs
packages/api/test/reader-prepared-dashboards.test.mjs
packages/api/test/serverless-authoring.test.mjs
packages/api/test/single-node-maintenance.test.mjs
packages/api/test/source-http.test.mjs
packages/web/scripts/persona-journeys/README.md
packages/web/scripts/persona-journeys/harness.mjs
packages/web/scripts/persona-journeys/j4-reader-daily.mjs
packages/web/scripts/persona-journeys/run-all.mjs
packages/web/src/AISettings.tsx
packages/web/src/BuildForMe.tsx
packages/web/src/OEntry.tsx
packages/web/src/OModeNotice.tsx
packages/web/src/access.tsx
packages/web/src/api-client.ts
packages/web/src/style.css
packages/web/test/ai-settings-ui.test.mjs
packages/web/test/o-generative-ui.test.mjs
```
