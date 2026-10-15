# Headless v1 CLI

`packages/cli` is the Apache-2.0 `@opensight/cli` npm workspace. Its `opensight`
executable calls `@opensight/headless-sdk` for all 53 operations in
`docs/api/openapi-v1.yaml`. Node 24 or newer is required. This slice does not
publish an npm release or enable the hosted Lambda v1 surface.

## Build and command surface

From the repository root:

```sh
npm install
npm run build --workspace @opensight/cli
node packages/cli/dist/opensight.js --help
npm test --workspace @opensight/cli
```

The release installation command is `npm i -g @opensight/cli`; distribution
also requires the project's SDK dependency to be available. No publication is
performed by the build. Root `npm test` discovers the CLI through the existing
`packages/*` workspace list. The serverless dependencies stage copies its
manifest before `npm ci`.

| Noun | Commands |
| --- | --- |
| `dataset` | `list`, `describe`, `update`, `delete`, `query`, `describe-lineage`, `refresh`, `get-refresh-status` |
| `source` | `list`, `describe`, `delete` |
| `analysis` | `list`, `describe`, `create`, `update`, `delete`, `add-visual`, `update-visual`, `remove-visual`, `set-layouts`, `add-filter-group`, `update-filter-group`, `remove-filter-group`, `set-calculated-fields` |
| `dashboard` | `publish`, `list`, `describe`, `list-versions`, `describe-version`, `delete`, `delete-version`, `get-share`, `set-share`, `delete-share`, `query-visual`, `create-export` |
| `asset` | `list`, `list-analyses-summary`, `list-dashboards-summary`, `list-datasets-summary`, `search`, `move`, `copy`, `get-share`, `set-share`, `delete-share` |
| `folder` | `list`, `describe`, `list-assets`, `rename`, `delete`, `get-permissions`, `set-permissions` |

Every noun and command accepts `--help` without credentials or network calls.
The command table derives from operation IDs, resource paths, parameters and
request schemas; `publish_analysis` uses the spec's dashboards tag. Asset-share
operations use the explicit `asset` noun and cover the spec's analyses route
only. There are no aliases that introduce a second mapping for an operation.

The primary path `id` is positional or `--id`; other path identifiers use
camelCase flags (`--sheetId`, `--visualId`, `--principalType`, `--principalId`,
`--kind`, `--version`). Header flags are `--limit`, `--cursor`,
`--idempotencyKey`, and `--ifMatch`, only where the spec declares them.
Required arguments and schema types come from the generated table.

Supply body fields as camelCase flags, with objects and arrays encoded as
inline JSON. Alternatively supply the whole JSON body with `--body` (or
`--query` for `dataset query`); these forms cannot be mixed. Array bodies such
as layouts use `--body`. No request files or credential files are read.
An export's wire `format` property belongs inside `--body`, since the global
`--format` controls presentation. `asset search` takes `--query`, the actual
wire property; the IDD's illustrative `--name` is not in the spec. Asset
deletion uses the corresponding resource's `delete` command; there is no
separate generic asset-delete operation in v1.

```sh
opensight dataset list --limit 20
opensight dataset describe sales --format table
opensight asset search --query Sales --kinds '["analyses","datasets"]'
opensight dataset update sales --name Sales --expectedVersion 0 \
  --pipeline '{"version":1,"steps":[]}'
opensight dataset query sales --query '{"dimensions":[],"measures":[{"fieldId":"total","columnName":"amount","aggregation":"SUM"}],"filters":[]}'
opensight dashboard publish analysis-1 --dashboardId report-1
opensight dashboard create-export dashboard-1 --body '{"format":"csv"}'
```

Queries accept the existing structured dimensions, measures and parameterized
filters. No command accepts, composes or executes ad-hoc SQL. Domain rules,
authorization, grants and data access remain the API's responsibility.

## Credentials and endpoints

| Variable | Meaning |
| --- | --- |
| `OPENSIGHT_API_URL` | Required API root ending in `/api` or `/api/v1`. The CLI normalizes this to the SDK's `/api` root. |
| `OPENSIGHT_TOKEN` | Required operator-issued user/tenant refresh credential. It is never printed or persisted. |
| `OPENSIGHT_TOKEN_URL` | Operator-supplied OAuth refresh endpoint, with no default. |

The token URL setting may be omitted, but an authenticated command then fails
closed with `CLI_TOKEN_EXCHANGE_REQUIRED`. A refresh credential is never used
as an access bearer. This is the existing D-70 integration boundary: the API
has no built-in refresh exchange, and this package does not invent one. An
operator-configured exchange (including a local stub) makes the CLI usable
with the existing self-hosted v1 surface. Help does not need the endpoint.

Exchange matches the MCP adapter: an OAuth form with `grant_type=refresh_token`
and `refresh_token`; the response must contain `access_token`, Bearer
`token_type`, and a positive numeric `expires_in`. Returned refresh rotation
data stays in process memory. There is one exchange per invocation, no retry
or disk persistence; the operator manages valid refresh credentials across
invocations. Revoked/rejected exchanges fail with `AUTHENTICATION_FAILED`.

URLs require HTTPS, except HTTP on loopback. URL credentials, query strings,
fragments and redirects are rejected. There is no login command, config file,
credential flag, browser-session fallback or guessed exchange URL. Local
configuration errors name the variable without exposing its value. Reflected
credentials in API bodies, errors, ETags or decoded export bytes are suppressed.

## Output and concurrency

Default stdout is exactly the API response JSON, followed by a newline.
`--format yaml` preserves the same data using quoted strings and keys.
`--format table` has handwritten list/describe renderers only; unsupported
formats fail before any API call, including mutations. List output preserves
`nextCursor` and does not fetch additional pages automatically.

The SDK's versioned results retain their ETag as one JSON metadata line on
stderr, `{"etag":"\"3\""}`, with exit status **0**. This keeps stdout equal to
the API body while making optimistic edits possible even when that body does
not contain a version. Read the metadata from `analysis describe`, for example,
and pass its exact quoted value as `--ifMatch '"3"'`. There is no automatic
precondition discovery, retry, or idempotency-key generation. SDK methods that
do not expose response ETags do not manufacture metadata.

Errors always produce one JSON object on stderr with `errorCode` and `message`,
empty stdout and exit status **1**, regardless of `--format`. API errors retain
their details, HTTP `status`, and SDK `retryAfter` when present. Scripts must
check the exit status to distinguish successful ETag metadata from errors.

Binary dashboard exports produce JSON/YAML with `base64`, `contentType`,
`contentDisposition` and `etag` from the SDK artifact. They do not write files
or emit binary bytes to a JSON pipeline.

## Generation, tests and dependencies

`npm run generate --workspace @opensight/cli` regenerates committed
`src/generated.ts`. Tests first reject a stale generated file, then compare
every operation, path, method, parameter and SDK adapter with the spec, including
one dispatch test per operation. Functional tests cover argument types,
required fields, pagination, concurrency, output formats, credential exchange,
secret reflection, SQL bypass attempts and the executable against loopback
HTTP stubs. Help and table descriptions are handwritten.

The only direct runtime dependency is the project's Apache-2.0 SDK. There are
no new third-party runtime dependencies or bundled binaries. Build/test tools
reuse the existing MIT `js-yaml`, MIT Node types and Apache-2.0 TypeScript
versions. The SDK's optional delete idempotency argument was added without
changing existing callers, so the CLI can forward the spec header entirely
through the SDK. `SOLUTION_DESIGN.md` and the OpenAPI contract are unchanged.
