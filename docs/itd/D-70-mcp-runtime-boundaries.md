---
status: ✅ Confirmed
owner: OpenSight implementation
date: 2026-10-14
labels: [itd]
---

## Purpose

Implement D-63/D-68 without inventing a hosted auth route or shipping
non-approved runtime licenses.

## Scope

MCP client credential adapter and runtime packaging.

## Out of Scope

Hosted refresh-token minting/exchange endpoints, serverless integration,
Streamable HTTP, and changes to the confirmed user/tenant authority model.

### ✅ ITD D-70 — How does the stdio client integrate the confirmed boundaries?

#### CONTEXT

D-63 requires an operator-provided refresh token. The current hosted server
implements login/switch/logout but no refresh exchange. D-68 requires the
official MIT SDK. Its optional transports and default validator transitively
install code under licenses outside AGENTS.md's shipped-code allowlist.

#### THE PROBLEM

The client needs a real exchange seam and an auditable MIT/Apache runtime;
neither a fabricated API route nor a blanket dependency-license exception fits.

#### OPTIONS CONSIDERED

1. Hardcode a new auth route or reuse a browser login token.
2. Configure the operator's OAuth refresh endpoint explicitly; bundle only the
   stdio runtime with the SDK's supported MIT validator provider.
3. Ship all SDK transitive dependencies or pin an old SDK to avoid the validator.

#### REASONING

Use option 2. `OPENSIGHT_MCP_TOKEN_URL` is required configuration, with no
default endpoint and no claimed hosted implementation. The client sends an
OAuth form (`grant_type=refresh_token`, `refresh_token`) and requires Bearer
`access_token` plus positive `expires_in`, accepting rotated `refresh_token`.
This adapter is an integration requirement, not a new OpenSight REST contract.
Only loopback may use plain HTTP. Redirects are refused. Refresh/access tokens
stay in process memory, never results or logs. The endpoint must issue the
same user/tenant identity and honor revocation; the client cannot mint authority.

Bundle the SDK server/stdio modules and its supported `CfWorkerJsonSchemaValidator`.
The build resolves the unused default Ajv provider import to this same official
provider, preventing its BSD URI dependency from entering the artifact. The
bundle license guard fails on any contributing package outside MIT/Apache-2.0,
and preserves upstream notices. Build/test-only dependencies are audited
separately and are not distributed. No license exception is granted.

#### IMPLICATIONS

- The stdio client can be tested with an HTTP exchange stub and the real hosted
  v1 server; running it against this repo's built-in auth still needs the
  operator's refresh exchange integration. Do not describe that gap as shipped.
- Runtime has no npm production dependencies; `dist` contains the bundled
  executable, library, declarations and notices. All runtime imports are Node
  built-ins or bundled MIT code. SDK upgrades must pass the bundle audit.
- Generated input schemas are the OpenAPI schemas; REST still owns semantic
  validation and named errors, including invalid queries and missing If-Match.
