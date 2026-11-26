import { readFileSync, writeFileSync } from 'node:fs';
const policy = JSON.parse(readFileSync(new URL('../../migration-extractor/policy/read-only.json', import.meta.url), 'utf8'));
const actions = policy.Statement.flatMap(s => s.Action).sort();
if (policy.Statement.some(s => s.Effect !== 'Allow') || actions.some(a => !/^quicksight:(List|Describe)[A-Za-z]+$/.test(a))) throw Error('Migration policy must stay List/Describe only');
const source = `// Generated from migration-extractor/policy/read-only.json. Do not edit.\nexport const migrationPolicyActions = ${JSON.stringify(actions, null, 2)} as const;\n`;
const file = new URL('../src/migration-policy.generated.ts', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== source) throw Error('Migration policy guidance is stale');
} else writeFileSync(file, source);
