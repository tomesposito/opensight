# D-100 — Registered MCP and hosted refresh deployment ✅

**Type:** ITD. **Date:** 2026-11-26.

## CONTEXT

The owner authorized syncing and deploying the latest release, including needed
AWS work. #332 adds connectable MCP and #282 adds hosted refresh credentials.
Their registered migration already recognizes pre-MCP/pre-refresh inventories.

## THE PROBLEM

The deployed inventory predates five new authentication tables. The older
retry/analytics operator bridge intentionally rejects this different transition.
CloudFront also routes discovery paths to static hosting, although the runtime
and generated API edge already implement their exact ingress boundary.

## OPTIONS CONSIDERED

1. Relabel compatibility or run runtime startup DDL: rejected.
2. ✅ A distinct, rehearsed registered transition with exact discovery routing.
3. Leave the authorized release undeployed.

## REASONING

Reuse the registered backup and transactional preservation protocol without
loosening its checks. The source inventory has current retry counters and
analytics quarantine; the target additionally has `h2_mcp_clients`,
`h2_mcp_interactions`, `h2_mcp_grants`, `h2_mcp_tokens` and `h2_refresh_tokens`.
Existing values remain exact and the new tables must be empty after migration.
The concurrently merged #334 adds `migration-import` to the resource-kind check
and requires a nonempty owner for that kind. Rehearse this exact constraint
expansion from the deployed checks; preserve every resource row and old check.

## IMPLICATIONS

- Bind a fresh operation, source/target manifests, current configuration and
  tested helper digests. Use expiring temporary authority, zero runtime
  concurrency, disabled queue mappings, full drain, an independent lock and
  watchdog, and a new registered snapshot before transactional migration.
- Preserve the external epoch and exact permitted future cleanup obligations
  under D-94. Never alter retention or synthesize object bindings. Retain every
  recovery entry, tombstone, retired key and fence high-water mark.
- Verify new tables' runtime operator DML grants, tenant denial and absence of
  runtime DDL. Rehearse retained rows/objects, migration replay, unexpected
  writes, partial inventories and rollback on preservation failure.
- Verify that migration-import records require a member owner after migration;
  retain the existing global-resource and prepared-dataset ownership constraints.
- Route `/.well-known/oauth-*` through one uncached API cache behavior in both
  infrastructure entry points. The Free plan permits five cache behaviors; four
  ordered behaviors plus the default fit that limit. The API viewer-request
  function admits only `/.well-known/oauth-protected-resource`,
  `/.well-known/oauth-protected-resource/api/mcp` and
  `/.well-known/oauth-authorization-server`; reject every other wildcard match
  before origin access. Preserve exact host checks, TLS, disabled caching,
  existing origin authorization and dynamic response headers. Assert the
  Free-plan behavior budget and exercise unknown suffixes and subpaths.
- If a failed held promotion has already committed the additive migration, a
  later attempt captures that actual current inventory in a fresh registered
  snapshot. Preserve all five authentication tables and prior migration receipts;
  never relabel a pre-migration snapshot or reuse the closed operation. Rehearse
  same-inventory preservation and rollback before retrying.
- Preserve SMTP sender/policy, static CSP, Stripe configuration and SES sandbox.
  Promote the attested image/frontend and reviewed edge under the held operation.
  Verify live discovery, consent/token boundaries, refresh rotation/reload,
  authoring and tenant isolation before committing actual release evidence.
- Before reopening, failures retain the snapshot and restore prior code/edge
  where verified compatible with the additive schema. After reopening, close
  admission for forward reconciliation instead of restoring over new writes.
  Reconcile private configuration and remove temporary authority after readback.
