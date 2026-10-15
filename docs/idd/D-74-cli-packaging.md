---
status: ✅ Confirmed (product owner, 2026-10-14)
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve how the `opensight` CLI is distributed.

## Scope

The install story for the v1 CLI: npm package, standalone binary, or
something else. Follows D-37 ✅ (SDKs generated, TS first) and the
AGENTS.md §2.5 rule (MIT/Apache-2.0 bundled code only).

## Out of Scope

Subcommand vocabulary (D-71), output format (D-72), credential
carriage (D-73), generated vs hand-authored internals (D-75).

### ✅ IDD D-74 — How should the CLI be packaged and installed?

#### CONTEXT

The headless delivery shapes already live in the npm workspace:
`packages/headless-sdk` (`@opensight/headless-sdk`, TS) and
`packages/mcp-server` (official TS MCP SDK, stdio), plus
`packages/headless-sdk-python` (pip-installable, with an npm shim so
it runs under root `npm test`). The repo builds and tests everything
with npm workspaces; the serverless Dockerfile copies package
manifests per workspace (see the MCP CI fix and the Python SDK fix).

#### THE PROBLEM

A standalone binary (pkg/deno-compile) removes the Node
prerequisite but adds a build matrix (OS × arch), a signing story,
and distribution plumbing the project doesn't have. An npm package
is free to distribute but assumes Node — which every existing
delivery shape already assumes.

#### OPTIONS CONSIDERED

1. **`@opensight/cli` npm package built on `@opensight/headless-sdk`.**
   Thin command layer over the SDK: no invented wire logic, inherits
   the SDK's conventions (named `errorCode` errors, `Limit`/`Cursor`
   headers, `Idempotency-Key`, `If-Match`) and the OpenAPI↔SDK
   coverage guard. Install: `npm i -g @opensight/cli`. Zero new
   runtime dependencies; AGENTS.md §2.5 audit is a non-event.
2. **Standalone binary.** `opensight` as a single downloadable
   executable per platform. Nicer install story for non-Node users;
   needs a compile matrix, code signing, and a release channel —
   none of which exist in this repo today.
3. **Ship inside the SDK package.** No new package at all; the CLI
   rides as a bin entry in `@opensight/headless-sdk`. Couples two
   products with different release cadences; muddies the "generated
   SDK" story.

#### RECOMMENDATION

Option 1. It composes with what's built: the SDK already owns the
conventions, the workspace already builds npm packages, and the
license audit passes by construction (the CLI's only runtime dep is
the project's own MIT/Apache-2.0 code). A standalone binary is a
later distribution slice if non-Node users actually show up.

#### IMPLICATIONS

- CLI bugs fix as SDK or CLI-layer fixes; the command layer stays
  thin enough that "CLI does X but SDK doesn't" can't happen.
- The root `npm test` and Docker dependency stages gain one more
  workspace manifest — the same two-line pattern as the MCP and
  Python SDK fixes.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-37](D-37-headless-first-api.md), [D-68](D-68-mcp-packaging.md)
