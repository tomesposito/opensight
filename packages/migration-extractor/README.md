# OpenSight migration extractor

Customer-run, read-only QuickSight definition extraction for issue #334 (D-97).
Requires Node 24+ and this repository's npm workspace installation.

```sh
npm run build --workspace @opensight/migration-extractor
node packages/migration-extractor/dist/cli.js --help
node packages/migration-extractor/dist/cli.js --policy
```

Set `AWS_ACCOUNT_ID`, `AWS_REGION` and your standard AWS credential-chain
configuration in your own environment. For example, select an already configured
SSO profile with `AWS_PROFILE`; no credential arguments are accepted or saved.

```sh
node packages/migration-extractor/dist/cli.js --out ./migration-first
node packages/migration-extractor/dist/cli.js --out ./migration-next \
  --previous ./migration-first/manifest.json
```

The output directory must be new, with an existing local parent. Outputs are
`bundle.json` and `manifest.json`. Exit 2 means some assets failed closed; inspect
the manifest before import. Read the [migration guide](../../docs/migration-extractor.md)
for selections, IAM permissions, contracts, bounds, known limits and remaining
v1/MCP/Ask O work. Tests use mocks only; no live QuickSight verification is claimed.
