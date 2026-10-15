---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve how the `opensight` CLI carries its credential.

## Scope

Where the CLI gets the bearer credential for v1 calls: environment,
config file, or interactive flow. Follows D-37 ✅ (user-level,
tenant-scoped credentials provisioned through the operator
invitation/minting path) and D-63 ✅ (MCP server started with an
operator-provided refresh token; no per-tool credentials).

## Out of Scope

Hosted refresh-token minting/exchange endpoints (the remote dev's
handoff per D-70 ITD — not claimed shipped); subcommand vocabulary
(D-71); output format (D-72); packaging (D-74).

### 🚧 IDD D-73 — How does the CLI authenticate?

#### CONTEXT

D-37 decision 4 ✅: API credentials are user-level, scoped to
user-tenant, provisioned through the existing operator
invitation/minting path — not self-service signup. The v1 contract
uses secure refresh tokens (freeze Q2), short-lived access, rotation,
revocation. The MCP server (D-63 ✅, D-70) takes the refresh token
from the process environment at startup; there is no hosted exchange
endpoint yet, so any client-side refresh adapter is a configured
stub pointing at an operator-supplied endpoint (as the MCP client
does with `OPENSIGHT_MCP_TOKEN_URL`).

#### THE PROBLEM

A config file with a stored secret is convenient and dangerous (a
long-lived credential on disk, plaintext, copied between machines).
An interactive login flow doesn't exist yet (no hosted exchange
endpoint, no browser session for agents). The CLI needs a credential
story that works today without inventing a new auth path.

#### OPTIONS CONSIDERED

1. **Environment variables only.** `OPENSIGHT_TOKEN` (a refresh
   token from the operator invitation/minting path) and
   `OPENSIGHT_API_URL`; optional `OPENSIGHT_TOKEN_URL` pointing at
   the operator's refresh endpoint once it exists. No secrets on
   disk, nothing to leak via file sync; matches the MCP server's
   D-63 credential model exactly. Inconvenient for interactive
   humans who must export on every shell.
2. **Env first, config-file fallback.** Adds
   `~/.opensight/credentials` (0600) as a second lookup. Nicer for
   humans; puts a plaintext secret on disk and needs a
   `opensight login`-shaped flow to write it — which doesn't exist
   yet, so v1 of the file would be hand-edited anyway.
3. **Interactive device/OAuth flow now.** Invents the hosted
   exchange endpoint the D-70 ITD deliberately left to the remote
   dev/operator. Ships a flow whose server side doesn't exist.

#### RECOMMENDATION

Option 1. Same credential model as the MCP server (env-provided
refresh token, no plaintext secret on disk), consistent with D-63
and with the fact that the exchange endpoint is the operator's
handoff, not this slice's invention. Config-file storage and an
interactive flow return as their own slices once the hosted
exchange exists.

#### IMPLICATIONS

- The CLI's auth is a two-line shell export; CI/agents carry the
  token the same way the MCP server does.
- No `opensight login` command in this slice; the operator
  invitation/minting path is the only credential source.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-37](D-37-headless-first-api.md), [D-63](D-63-mcp-credential.md), [D-70](../itd/D-70-mcp-runtime-boundaries.md)
