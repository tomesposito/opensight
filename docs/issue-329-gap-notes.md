# Issue #329 — workspace AI spend caps bind MCP questions

`POST /api/v1/ai/ask` exposes the existing generative dataset question flow.
MCP and CLI regenerate from OpenAPI with 57 operations, including
`ask_question`; the TypeScript and Python headless SDKs map the same endpoint.
The response remains `{ interpretations, errors, question }`. Query execution
is separate. The adopted brief clarification supersedes the blocked draft and
uses a dedicated `region,revenue` fixture instead of changing `weekly-sales`.

Hosted v1 asks delegate to `HostedAI` and the shared `generateAnswer` path.
The existing `ai`/`build` capability checks, dataset scope, PII guard, policy
rechecks and answer receipts apply. Managed `HostedAISettings.complete` checks
`HostedUsage.aiMeter()` before transport, records completion tokens, then
charges monthly credits only for delivered answers. Local/self-hosted asks
use the existing generative machinery and `AISettings.complete` for the
configured `sales` binding, including its optional meter. Other local dataset
IDs return 404; missing AI/auth composition or provider returns named 503
`AI_NOT_CONFIGURED`. The static demo cannot serve generative requests.
See [AI spend caps](ai-spend-caps.md#headless-ai-questions-329).

## Verification

Focused API verification passed **99 passed / 0 failed / 0 skipped**. Coverage
includes the OpenAPI answer shape, a managed 12-token completion followed by
429 `AI_SPEND_CAP_EXCEEDED` with exactly one provider invocation, separately
executed grounding, capabilities, missing/other-owner datasets, PII stops,
body validation, absent provider, authorization revocation and receipt replay.
Local tests cover the sales binding, optional meter, capabilities and PII stop.
SDK and generated MCP/CLI suites passed after wiring the CLI adapter and help.

The root build passed. Final root-suite counts will be recorded after verification.
The first full-suite process ended with SIGTERM before a summary and is excluded
from the final counts; the fresh run uses a disk-backed temporary directory and
records its completion status separately. That run exposed the edge generator's
requirement that the shared identifier declaration remain first. The new route
now follows it, both edge allowlists are regenerated, and all 13 edge tests pass,
including AI ask admission and neighboring-path denials. Final counts come from
a new complete root run after that correction.

J10 completed with **11 passed / 0 failed / 0 skipped / 1 gap** against local
PostgreSQL 16.4 on localhost:5433 and the real MCP/hosted API stack. The dedicated
member-owned `ai-sales` fixture has east 17 + 31 = **48**, west **23**. Its first
`ask_question` yields a valid interpretation; the separate `run_dataset_query`
returns exactly those totals. The managed stub reports **12 tokens**;
`aiSpendCapCents: 12` and `aiCostCentsPerMillionTokens: 1_000_000` record **12 cents**.
The second ask returns 429 `AI_SPEND_CAP_EXCEEDED` without rows or interpretations
while **9 of 10 monthly AI credits remain**. Entitlement numbers needed no adjustment.
The only remaining gap is `audit-member-identity` (#330). Existing weekly-sales,
metric, CLS, PII, compute-quota and human-review behavior is unchanged. J10 launches
no browser and captures no screenshots; its shared health step passes.

Logs and the journey JSON remain outside version control under `/tmp/issue-329-*`.
No dependency, provider behavior, pricing or `SOLUTION_DESIGN.md` change was made.

## Static demo and reference comparison

The static demo was rebuilt from the passing root build and captured offline
with the installed Playwright headless Chromium. The classic editor, new-look
editor and Home Q captures report **0 page errors / 0 external requests** and
are byte-for-byte identical to the prior issue #327 captures. The established
reference pairings, regions, exclusions and pixel tolerance of 16 give:

| Reference pairing | Differing pixels |
| --- | ---: |
| Classic editor | 41.22% |
| New-look editor | 33.97% |
| Q generative | 45.30% |

These are pixel differences, not fidelity grades. The existing reference
mismatches include fixture content, empty analysis, offline notices and product
chrome. No new visual gap was identified. Captures and reports remain outside
version control in `.opensight/issue-329/`. This slice changes no web UI; README
images need no refresh. The demo is a local static artifact, not a deployed server.
