---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-11-24
labels: [idd]
---

# IDD D-95 — A connectable MCP for OpenSight

## CONTEXT

The 58-tool v1 MCP server shipped as stdio with an operator-supplied OAuth
exchange. The hosted app did not supply that exchange, so an external host
could not connect through its standard connector flow. Tom approved all six
recommendations in the connectable-MCP draft on 2026-11-24 (issue #332).

## THE PROBLEM

Make the existing governed tools connectable without manual client IDs,
secrets, or a separately operated authorization server.

## OPTIONS CONSIDERED

Adopt freeDMS's hosted Streamable HTTP and in-app OAuth pattern; supply only
the missing exchange for stdio; or retain an operator integration. Also
considered AI-members-only access, a single scope, operator-only revocation,
and sign-in without explicit consent.

## REASONING

Tom ruled all questions as recommended: hosted Streamable HTTP alongside
unchanged local stdio; any member connects as themselves; separate
`opensight/mcp.read` and `opensight/mcp.write` scopes chosen at consent;
one-hour access tokens and rotating refresh tokens; self-serve revocation
in member account settings; and an in-app consent screen naming the client,
workspace and requested scopes with approve/deny controls. Both scopes remain
bounded by the member's role and every v1 guard.

## IMPLICATIONS

The app supplies discovery, dynamic public-client registration, PKCE,
authorization-code exchange, refresh and revocation. Calls retain tenant
isolation, role permissions, CLS, the PII field-name stop, compute quotas,
AI spend caps and action history attributed to the delegating member.

This supersedes D-70's exclusion of hosted token minting/exchange and
Streamable HTTP; its other boundaries stand. No new tools, CLI/SDK changes,
AWS work or human-only operations are authorized. Hosted connector proof
follows Tom's deploy step. This IDD is distinct from the existing
[ITD D-95](../itd/D-95-operator-readiness.md).
