# Headless v1 — MCP server (issue #95)

Status: **Implemented stdio client**, API target **1.0.0**, server **1.0.0**.
The 2026-10-13 proposal's review gate was resolved by confirmed
[D-42](idd/D-42-headless-mcp-server.md) and D-62–D-69 on 2026-10-14.
The implementation lives in `packages/mcp-server`.

**Operator integration prerequisite:** this repository's built-in hosted auth
has login/switch/logout but no refresh-token exchange endpoint. The MCP client
requires an explicitly configured operator exchange endpoint issuing Bearer
access for the same user and tenant. That endpoint is not shipped by this
slice. No browser-session or long-lived API-key fallback is provided. See
[ITD D-70](itd/D-70-mcp-runtime-boundaries.md).

## Runtime and configuration

Build from the repository root:

```sh
npm install
npm run build --workspace @opensight/mcp-server
```

Configure the process environment through the MCP host or operator secret
configuration; do not put token values in command-line arguments or files in
this repository:

| Environment variable | Meaning |
| --- | --- |
| `OPENSIGHT_MCP_BASE_URL` | Full hosted v1 root, ending in `/api/v1` |
| `OPENSIGHT_MCP_TOKEN_URL` | Explicit operator OAuth refresh endpoint; no default or guessed OpenSight route |
| `OPENSIGHT_MCP_REFRESH_TOKEN` | User/tenant refresh credential from the invitation/minting path |

Run `node packages/mcp-server/dist/cli.js` as the MCP host's stdio command.
The configured endpoints must use HTTPS; HTTP is allowed only on loopback for
local operation and tests. URLs cannot contain userinfo, query strings or
fragments. HTTP redirects are refused. Stdout contains MCP protocol frames
only. Startup failures produce one fixed stderr diagnostic, never credentials,
URLs, query results or upstream exception objects.

The exchange sends an OAuth form with `grant_type=refresh_token` and
`refresh_token`. It requires `access_token`, Bearer `token_type` and positive
numeric `expires_in`; a returned `refresh_token` replaces the token in memory.
Startup exchanges before connecting stdio. Access is reused only until its
expiry margin, concurrent exchanges coalesce, and an API 401 invalidates the
cached access token. Failed exchange/revocation never falls back to another
identity or retries a mutation. Rotation is memory-only: after process loss,
the operator must supply a valid refresh credential again. The endpoint owns
minting, identity binding, rotation and revocation; this client cannot create
or widen authority.

The package calls HTTP only. Production code imports no API handlers, metadata
stores, query engines or other OpenSight packages. It has no resource cache,
idempotency store, sessions, persistence, network listener, prompts or resources.
REST owns auth, owner/tenant isolation, admission, budgets, metering and rate
limits; MCP calls consume the same tenant bucket as direct HTTP calls.

## Mechanical inventory and inputs

`npm run generate --workspace @opensight/mcp-server` parses
[`openapi-v1.yaml`](api/openapi-v1.yaml), resolves local request schema references,
and generates `src/generated.ts`. Missing/duplicate/non-snake-case IDs,
unsupported headers, external references and parameter collisions fail the
build. No network access is used in generation or compilation.

There are **53 tools**, one per implemented OpenAPI operation: 11 dataset/source/
query operations, 13 analysis operations, 12 dashboard operations and 17
asset/folder/share additions. The old 11-tool and 40-deferred-tool proposal
tables are superseded by the shipped REST inventory on master `4989fdc1`.
The spec-only checkpoint added nine missing IDs and renamed `runDatasetQuery`
to `run_dataset_query`; REST wire behavior did not change.

Tool name equals `operationId`; each description quotes its method and complete
`/api/v1` route. Input schemas come from OpenAPI, including required properties,
limits, unions, enums and `additionalProperties`. No request schema is handwritten.

- Path parameters keep their exact names, such as `id`, `sheetId`, `version`.
- `limit` and `cursor` map to `Limit` and `Cursor` headers on listed operations.
- `idempotencyKey` maps to `Idempotency-Key`; `ifMatch` maps to `If-Match`.
- `run_dataset_query` takes `{ id, query: InteractiveQuery, idempotencyKey? }`.
- Other JSON bodies travel as `body`, preserving them without collisions with
  path/header fields. `refresh_dataset` generates its documented empty body.
- Unsupported top-level arguments fail closed. Caller credential/principal/
  policy assertions return `FORGED_PRINCIPAL`, including nested envelopes.
  Documented share *targets* (`principalType`, `principalId`, permission
  `principal`/`role` fields) remain valid; they never replace the caller.
  Parameter/control/binding map names remain data, even if named `userId`.

The OpenAPI schema is advertised to MCP clients. The query body is also
validated locally against the generated schema. REST performs authoritative
request/semantic validation; invalid inputs still reach its boundary so auth,
rate limiting and exact named error precedence remain intact. If a backend
unexpectedly accepts a schema-invalid query, MCP refuses to publish its result.
Bodies are forwarded unchanged, so SQL strings,
envelopes, unknown operators and nested extra properties get the same named
errors as direct REST. Calculated-field expressions pass the existing parser;
SQL-looking filter literals remain data. No query result is truncated or
inventively paginated. Source protection and definition grants never widen
prepared-data access.

REST concurrency semantics apply exactly. Missing required If-Match reaches
REST and returns its named 428 error. The shipped `delete_dashboard_share`
operation has no If-Match header: MCP does not invent a precondition for it.
No tool exists for unversioned uploads, `/api/o/query`, local/admin routes,
proposed operations or composite workflows. Discovery does not call the API.

## Results and failures

JSON success bodies are unchanged in both `structuredContent` and JSON text
content, including list `nextCursor`. Result `_meta.status` is the HTTP status;
`_meta.headers` preserves `ETag`, `Idempotent-Replayed`, `Retry-After`,
`Content-Type` and `Content-Disposition` when present. ETags can therefore be
supplied to the next mutation without inventing a version.

An API failure returns `isError: true` and structured `{ errorCode, message }`,
retaining additional REST diagnostics. REST messages remain unchanged. Hosted
boundary errors currently omit `message`; the adapter supplies the same named
`errorCode` as the message in that case. A 429 retains `RATE_LIMIT_EXCEEDED`
and `Retry-After`, with no client retry or alternate limiter.

Protocol errors, unknown tools, transport failures and malformed API responses
are MCP protocol errors. Errors are fixed/redacted; reflected configured
credentials are rejected, including JSON-escaped credentials. No protocol
logging capability is advertised and no request/result logging is installed.

`create_dashboard_export` preserves binary bytes as `{ base64, mimeType }` in
structured/text content plus response metadata. This is a lossless transport
representation of the REST artifact, not a new MCP resource or a cached URL.

## Dependencies and packaging

The official TypeScript MCP SDK **1.32.1** is verified MIT from its installed
manifest and license. The shipped runtime is bundled with the official SDK's
MIT `@cfworker/json-schema` **4.1.1** validator provider and MIT `zod` **4.6.7**.
Build output contains a runtime license audit and full upstream notices.
The build rejects any contributing runtime package outside MIT/Apache-2.0 and
any unresolved non-Node import. There are no npm production dependencies.

The SDK's unused optional HTTP/client transports are not bundled. Its supported
MIT validator replaces the unused default Ajv import at bundle time; its unused
Zod-v3 converter is removed by tree shaking. No SDK protocol implementation is
forked. The [dependency audit](issue-95-mcp-dependencies.md) distinguishes
shipped runtime code from build/test-only transitive packages; no license
exception is granted. SDK upgrades must pass the same gate.

## Verification and resume boundary

The package test script participates in root `npm test`. It covers exact
OpenAPI↔tools/list inventory, every operation's method/path/headers/body,
response metadata, real stdio startup, refresh/rotation/revocation, credential
redaction, forbidden assertions, binary exports, real hosted SQL rejection,
idempotency, If-Match, shared tenant rate limits, cross-owner/cross-tenant
isolation and definition-grant/data-access separation. Fixtures are synthetic;
test-only API imports never enter the runtime bundle.

The proposal-first resume boundary is complete for the MCP client: approved
contracts are recorded, tool generation and transport/auth adapters are
implemented, and contract/security tests are wired into the full suite.
[Gap notes](issue-95-mcp-gap-notes.md) record final counts and demo comparison.

Remaining boundaries are explicit: the operator refresh-exchange integration
above; serverless `/api/v1` durable adapters owned by the remote developer;
Streamable HTTP as its own slice. The [Python SDK](headless-v1-sdk.md) and
[CLI](headless-v1-cli.md) now cover the same v1 operations. Issue
#95 remains open. This slice changes no UI and does not deploy a server.
Breaking tool changes require a version bump and migration notes (D-69).
