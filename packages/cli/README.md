# @opensight/cli

Apache-2.0 command line client for the OpenSight v1 API, using
`@opensight/headless-sdk`. Requires Node 24 or newer.

After publication, install with `npm i -g @opensight/cli`. From a repository
checkout, run `npm run build --workspace @opensight/cli`, then
`node packages/cli/dist/opensight.js --help`.

```sh
opensight --help
opensight dataset list --limit 20
opensight dataset describe sales --format table
opensight asset search --query Sales
opensight analysis add-visual --help
```

Set `OPENSIGHT_API_URL` to an API root ending in `/api` or `/api/v1` and
`OPENSIGHT_TOKEN` to an operator-issued refresh credential. Configure
`OPENSIGHT_TOKEN_URL` with the operator's OAuth refresh endpoint for API calls.
There is no default exchange endpoint, login command, credential file or
credential flag. Without an exchange URL, authenticated commands fail closed;
help remains available. URLs require HTTPS except on loopback.

JSON is the default stdout format; `--format yaml` is available everywhere,
and `--format table` on list/describe commands. Errors are JSON on stderr with
`errorCode` and exit status 1. Successful versioned SDK results emit
`{"etag":"\"3\""}` metadata on stderr with exit status 0; use that quoted value
for a subsequent `--ifMatch`. Binary exports return base64 and SDK metadata.

Primary IDs are positional; all other argument names follow camelCase wire
parameters. Objects/arrays are inline JSON. `--body` accepts a complete request
body (`--query` for dataset queries), instead of individual body-field flags.
The CLI exposes exactly the 53 frozen v1 operations; no raw SQL is accepted.
See `docs/headless-v1-cli.md` in the repository for the command table and
complete output, credential and generation contracts.
