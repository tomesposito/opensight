# Issue #95 MCP dependency audit

Audited against the installed packages and lockfile on 2026-10-14. No existing
lockfile package version or metadata changed; these are additions.

## Shipped runtime

The esbuild contribution graph contains exactly these third-party packages:

| Package | Version | License |
| --- | --- | --- |
| @modelcontextprotocol/sdk | 1.32.1 | MIT |
| @cfworker/json-schema | 4.1.1 | MIT |
| zod | 4.6.7 | MIT |

The SDK and Zod license texts are read from their installed distributions.
The validator's npm archive omits its license file; the unmodified upstream
[MIT license](https://github.com/cfworker/cfworker/blob/master/LICENSE.md) is
retained in packages/mcp-server/licenses/cfworker-MIT.txt. Full notices and
license-audit.json are emitted into dist. The gate fails if a contributing
package has another license or a runtime import is left unbundled.

Build tools: js-yaml 4.1.1 and esbuild 0.25.12 are MIT (installed license
texts checked); TypeScript and Node type declarations were already present.

## Newly installed build/test graph

The SDK includes optional HTTP/client and compatibility dependencies. Those
under ISC/BSD/Python licenses are **not bundled or shipped**; AGENTS.md's
allowlist governs shipped code, not tools used to build/test it. There is no
new license exception. This complete additions inventory records every new
resolved package license, including unused optional platform binaries.

| Package | Version | Declared license |
| --- | --- | --- |
| `@cfworker/json-schema` | 4.1.1 | MIT |
| `@esbuild/* (platform binaries)` | 0.28.2 | MIT |
| `@esbuild/* (platform binaries)` | 0.25.12 | MIT |
| `@hono/node-server` | 2.1.5 | MIT |
| `@modelcontextprotocol/sdk` | 1.32.1 | MIT |
| `accepts` | 2.0.0 | MIT |
| `ajv` | 8.20.0 | MIT |
| `ajv-formats` | 3.0.1 | MIT |
| `argparse` | 2.0.1 | Python-2.0 |
| `body-parser` | 2.3.0 | MIT |
| `bytes` | 3.1.2 | MIT |
| `call-bind-apply-helpers` | 1.0.2 | MIT |
| `call-bound` | 1.0.4 | MIT |
| `content-disposition` | 2.0.1 | MIT |
| `content-type` | 2.1.0 | MIT |
| `content-type` | 1.0.5 | MIT |
| `cookie` | 0.7.2 | MIT |
| `cookie-signature` | 1.2.2 | MIT |
| `cors` | 2.8.6 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `debug` | 4.4.3 | MIT |
| `depd` | 2.0.0 | MIT |
| `dunder-proto` | 1.0.1 | MIT |
| `ee-first` | 1.1.1 | MIT |
| `encodeurl` | 2.0.0 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es-object-atoms` | 1.1.2 | MIT |
| `esbuild` | 0.28.2 | MIT |
| `esbuild` | 0.25.12 | MIT |
| `escape-html` | 1.0.3 | MIT |
| `etag` | 1.8.1 | MIT |
| `eventsource` | 3.0.7 | MIT |
| `eventsource-parser` | 3.1.1 | MIT |
| `express` | 5.3.0 | MIT |
| `express-rate-limit` | 8.7.1 | MIT |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fast-uri` | 3.1.8 | BSD-3-Clause |
| `finalhandler` | 2.1.1 | MIT |
| `forwarded` | 0.2.0 | MIT |
| `fresh` | 2.0.0 | MIT |
| `function-bind` | 1.1.2 | MIT |
| `get-intrinsic` | 1.3.0 | MIT |
| `get-proto` | 1.0.1 | MIT |
| `gopd` | 1.2.0 | MIT |
| `has-symbols` | 1.1.0 | MIT |
| `hasown` | 2.0.4 | MIT |
| `hono` | 4.13.13 | MIT |
| `http-errors` | 2.0.1 | MIT |
| `inherits` | 2.0.4 | ISC |
| `ip-address` | 10.7.4 | MIT |
| `ipaddr.js` | 1.9.1 | MIT |
| `is-promise` | 4.0.0 | MIT |
| `isexe` | 2.0.0 | ISC |
| `jose` | 6.2.12 | MIT |
| `js-yaml` | 4.1.1 | MIT |
| `json-schema-traverse` | 1.0.0 | MIT |
| `json-schema-typed` | 8.0.2 | BSD-2-Clause |
| `math-intrinsics` | 1.1.0 | MIT |
| `media-typer` | 1.1.1 | MIT |
| `merge-descriptors` | 2.0.0 | MIT |
| `mime-db` | 1.54.0 | MIT |
| `mime-types` | 3.0.2 | MIT |
| `ms` | 2.1.3 | MIT |
| `negotiator` | 1.1.0 | MIT |
| `object-inspect` | 1.13.4 | MIT |
| `on-finished` | 2.4.1 | MIT |
| `once` | 1.4.0 | ISC |
| `parseurl` | 1.3.3 | MIT |
| `path-key` | 3.1.1 | MIT |
| `path-to-regexp` | 8.4.2 | MIT |
| `pkce-challenge` | 5.0.1 | MIT |
| `proxy-addr` | 2.0.8 | MIT |
| `qs` | 6.16.1 | BSD-3-Clause |
| `range-parser` | 1.3.0 | MIT |
| `raw-body` | 3.0.2 | MIT |
| `require-from-string` | 2.0.2 | MIT |
| `router` | 2.2.0 | MIT |
| `send` | 1.2.1 | MIT |
| `serve-static` | 2.2.1 | MIT |
| `setprototypeof` | 1.2.0 | ISC |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `side-channel` | 1.1.1 | MIT |
| `side-channel-list` | 1.0.1 | MIT |
| `side-channel-map` | 1.0.1 | MIT |
| `side-channel-weakmap` | 1.0.2 | MIT |
| `statuses` | 2.0.2 | MIT |
| `toidentifier` | 1.0.1 | MIT |
| `type-is` | 2.1.0 | MIT |
| `unpipe` | 1.0.0 | MIT |
| `vary` | 1.1.2 | MIT |
| `which` | 2.0.2 | ISC |
| `wrappy` | 1.0.2 | ISC |
| `yaml` | 2.8.1 | ISC |
| `zod` | 4.6.7 | MIT |
| `zod-to-json-schema` | 3.25.2 | ISC |
