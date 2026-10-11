import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (!process.env.DATABASE_URL) throw Error('ISOLATED_POSTGRES_REQUIRED');
const files = ['packages/api/test', 'packages/query-engine/test'].flatMap(dir => readdirSync(dir)
  .filter(name => name.endsWith('.test.mjs') && readFileSync(`${dir}/${name}`, 'utf8').includes('process.env.DATABASE_URL')).map(name => `${dir}/${name}`));
if (files.length < 10) throw Error('POSTGRES_COVERAGE_MISSING');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
