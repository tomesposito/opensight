import { build } from 'rolldown';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Existing locked build tooling only. No cloud calls, credentials, or application deployment.
const output = process.argv[2];
if (!output) throw Error('PILOT_RELEASE_OUTPUT_REQUIRED');
const directory = resolve(output);
await mkdir(directory, { recursive: true, mode: 0o700 });
await build({ input: 'packages/api/dist/pilot-release-lambda.js', platform: 'node',
  external: id => id === 'pg-native' || id.startsWith('@duckdb/'),
  treeshake: { moduleSideEffects: id => !id.startsWith('@duckdb/') },
  output: { file: join(directory, 'index.mjs'), format: 'esm', codeSplitting: false,
    banner: "import { createRequire as inspectionRequire } from 'node:module'; const require = inspectionRequire(import.meta.url);" } });
await copyFile('ops/serverless/rds-ca.pem', join(directory, 'rds-ca.pem'));
console.log('Temporary pilot maintenance bundle prepared. Zip index.mjs and rds-ca.pem for a temporary private Node.js Lambda.');
