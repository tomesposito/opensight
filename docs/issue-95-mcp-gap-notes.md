# Issue #95 MCP — verification and demo comparison

The slice implements the stdio MCP client for all 53 implemented v1 REST
operations. It changes no web UI. The static demo is rebuilt locally; this is
not a deployed server. Verification artifacts remain outside version control
under `.opensight/issue-95-mcp-impl/`.

## Full-suite verification

Full root `npm test` exited **0** on 2026-10-15: **2,827 tests — 2,809 passed / 0 failed / 18 skipped / 0 cancelled**.
Every skip requires live PostgreSQL (`DATABASE_URL` is unset). The MCP suite
passed **74 / 0 / 0** in this root run, including all final security fixes.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| api | 567 | 0 | 16 |
| bundle-parser | 199 | 0 | 0 |
| embedding-sdk | 10 | 0 | 0 |
| headless-sdk | 26 | 0 | 0 |
| mcp-server | 74 | 0 | 0 |
| o-interpreter | 32 | 0 | 0 |
| parity | 11 | 0 | 0 |
| query-engine | 505 | 0 | 2 |
| web | 1,328 | 0 | 0 |
| root conformance | 57 | 0 | 0 |
| **Total** | **2,809** | **0** | **18** |

## Contract and security verification

The OpenAPI inventory guard and per-operation mapping checks exercise all 53
tools through the official MCP client/protocol. Hosted integration checks use
real HTTP and the existing synthetic SQLite/auth fixtures, including SQL and
nested injection attempts, owner/tenant isolation, idempotency replay,
If-Match, shared tenant rate limiting, revoked access, protected sources and
real definition shares that cannot widen prepared-data access. A generated
query-schema guard refuses successful responses to schema-invalid requests.

CLI tests launch the bundled stdio executable against local HTTP endpoints and
check that credentials never enter results or stderr, including JSON-escaped
reflection. The runtime contribution audit reports only MIT code from the
SDK, its supported validator and Zod. See the [dependency audit](issue-95-mcp-dependencies.md).

## Static demo

The fresh demo's classic Author, new-look reference viewport and Home Q captures
are byte-identical to the preceding assets-slice captures. Browser verification
reports **0 page errors / 0 external requests**. Reference pairings retain the
same viewports, regions, exclusions and tolerance of 16:

| Reference pairing | Differing pixels |
| --- | ---: |
| editor-classic | 41.22% |
| editor-newlook | 33.58% |
| q-generative | 44.66% |

These are pixel differences, not fidelity grades. No new visible gap was
introduced; prior gaps remain in the [assets notes](issue-95-assets-gap-notes.md)
and their referenced issue history. No new visual issue is needed. README
screenshots and GIF remain current because this slice changes no visible UI.

## Resume boundary and remaining integration

D-42/D-62–D-69's approved MCP client implementation boundary is complete.
OpenAPI now has 53 unique snake_case operation IDs; missing IDs and the single
camelCase ID were corrected in a spec-only commit, with no REST wire changes.

The repo's built-in hosted auth still has no refresh-token exchange endpoint.
The MCP client requires an explicit operator OAuth exchange URL and has no
invented default endpoint or browser-session fallback. Its HTTP exchange is
verified using a stub; real hosted v1 admission is separately verified. This
is an integration prerequisite, not a claim that credential minting/exchange
has shipped. [D-70](itd/D-70-mcp-runtime-boundaries.md) records the boundary.

Serverless/Lambda durable adapters remain the remote developer's handoff;
Streamable HTTP, Python SDK and general API CLI remain future slices. Issue
#95 stays open. `SOLUTION_DESIGN.md`, serverless integration and GitHub workflow
files are untouched. No AWS calls or deployment were performed.
