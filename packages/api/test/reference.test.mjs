import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { referenceEnvironment } from '../dist/reference-postgres.js';
import { staticPath } from '../dist/reference-ingress.js';
test('H8 reference refuses fixture fallback, missing roles and shared database credentials', () => {
  const env = { OPENSIGHT_MODE: 'hosted', OPENSIGHT_WORKER_ROLE: 'api-query-scheduler', OPENSIGHT_METADATA_URL: 'postgres://operator@metadata/opensight', OPENSIGHT_TENANT_METADATA_URL: 'postgres://tenant@metadata/opensight' };
  referenceEnvironment(env);
  for (const name of Object.keys(env)) assert.throws(() => referenceEnvironment({ ...env, [name]: undefined }), { code: 'REFERENCE_CONFIG_INVALID' });
  assert.throws(() => referenceEnvironment({ ...env, OPENSIGHT_TENANT_METADATA_URL: env.OPENSIGHT_METADATA_URL }), { code: 'REFERENCE_CONFIG_INVALID' });
});
test('H8 ingress static allowlist denies traversal and nonpublic files', () => {
  assert.equal(staticPath('/web', '/'), '/web/index.html');
  assert.equal(staticPath('/web', '/assets/app.js'), '/web/assets/app.js');
  for (const path of ['/../secret.js', '/%2e%2e/secret.js', '/.env', '/api/key.json', '/app.js?secret=value', '/\\secret.js']) assert.equal(staticPath('/web', path), undefined);
});
test('H8 Compose exposes only HTTPS ingress and persists metadata separately from containers', async () => {
  const compose = await readFile(new URL('../../../deploy/compose.yaml', import.meta.url), 'utf8');
  assert.equal((compose.match(/ports:/g) ?? []).length, 1);
  assert.match(compose, /internal: true/); assert.match(compose, /metadata:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /OPENSIGHT_RUNTIME_ENV_FILE/); assert.match(compose, /OPENSIGHT_TLS_DIRECTORY/);
  assert.match(compose, /api-query-scheduler/); assert.match(compose, /pull_policy: never/);
});
