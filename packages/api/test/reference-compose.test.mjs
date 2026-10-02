import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, chmod, chown } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { environment } from './hosted-helpers.mjs';
import { budgetConfig } from './budget-helpers.mjs';
import { referenceCall, exerciseReference } from './reference-pilot-helpers.mjs';

const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 5000 });
test('H8 Docker integration: TLS Compose isolation/load, container restart and total-loss restore', { skip: docker.status === 0 ? false : 'Docker daemon/tooling unavailable; composed reference is not measured' }, async t => {
  for (const name of ['OPENSIGHT_COMPOSE_TEST_NODE_IMAGE', 'OPENSIGHT_COMPOSE_TEST_POSTGRES_IMAGE']) assert.ok(process.env[name], `${name} must select a reviewed local image; test never pulls images`);
  const project = `h8-${randomUUID().slice(0, 12)}`, directory = await mkdtemp(join(tmpdir(), 'h8-compose-'));
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const key = () => randomBytes(32).toString('base64url'), ownerPassword = key(), tenantPassword = key();
  const env = { ...environment(), OPENSIGHT_MODE: 'hosted', OPENSIGHT_WORKER_ROLE: 'api-query-scheduler', OPENSIGHT_PUBLIC_ORIGIN: `https://localhost:${port}`,
    OPENSIGHT_METADATA_URL: `postgresql://opensight_metadata:${ownerPassword}@metadata/opensight`, OPENSIGHT_TENANT_METADATA_URL: `postgresql://opensight_tenant:${tenantPassword}@metadata/opensight`,
    OPENSIGHT_NODE_LIMITS: JSON.stringify(budgetConfig.node), OPENSIGHT_TENANT_LIMIT_DEFAULTS: JSON.stringify(budgetConfig.defaults),
    OPENSIGHT_AUDIT_OPERATOR_KEY: randomBytes(32).toString('base64'), OPENSIGHT_BACKUP_KEY: randomBytes(32).toString('base64'), OPENSIGHT_BACKUP_PATH: '/recovery/backup.sealed' };
  const runtime = join(directory, 'runtime.env'); await writeFile(runtime, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });
  const cert = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  assert.equal(cert.status, 0, 'Local TLS test certificate generation');
  const uid = process.getuid() || 1000, gid = process.getgid() || 1000;
  if (process.getuid() === 0) { await chown(directory, uid, gid); await chown(join(directory, 'key.pem'), uid, gid); }
  await chmod(join(directory, 'key.pem'), 0o400);
  const override = join(directory, 'override.json');
  await writeFile(override, JSON.stringify({ services: { api: { user: `${uid}:${gid}`, volumes: [`${directory}:/recovery`] }, ingress: { user: `${uid}:${gid}` } } }));
  const composeEnv = { ...process.env, ...env, NODE_IMAGE: process.env.OPENSIGHT_COMPOSE_TEST_NODE_IMAGE, POSTGRES_IMAGE: process.env.OPENSIGHT_COMPOSE_TEST_POSTGRES_IMAGE,
    OPENSIGHT_APP_IMAGE: process.env.OPENSIGHT_COMPOSE_TEST_APP_IMAGE ?? 'opensight-reference:local', OPENSIGHT_POSTGRES_BOOTSTRAP_PASSWORD: key(), OPENSIGHT_METADATA_PASSWORD: ownerPassword,
    OPENSIGHT_TENANT_METADATA_PASSWORD: tenantPassword, OPENSIGHT_RUNTIME_ENV_FILE: runtime, OPENSIGHT_TLS_DIRECTORY: directory, OPENSIGHT_HTTPS_PORT: String(port) };
  const args = ['compose', '-p', project, '-f', fileURLToPath(new URL('../../../deploy/compose.yaml', import.meta.url)), '-f', override];
  const compose = (...command) => {
    const result = spawnSync('docker', [...args, ...command], { env: composeEnv, encoding: 'utf8', timeout: 60000 });
    if (result.status !== 0) throw new Error(`COMPOSE_REFERENCE_FAILED_${command[0]}`);
    return result.stdout;
  };
  t.after(async () => { try { compose('down', '--volumes', '--remove-orphans'); } finally { await rm(directory, { recursive: true, force: true }); } });
  compose('config', '--quiet'); compose('up', '-d', '--wait', '--pull', 'never', 'metadata');
  const offline = command => compose('run', '--rm', '--no-deps', '-e', 'OPENSIGHT_MAINTENANCE=frozen', 'api', 'node', 'packages/api/dist/reference-cli.js', command);
  offline('initialize');
  const actors = JSON.parse(compose('run', '--rm', '--no-deps', 'api', 'node', 'packages/api/test/reference-compose-seed.mjs'));
  compose('up', '-d', '--no-build', '--pull', 'never', 'api', 'ingress');
  const call = referenceCall(env.OPENSIGHT_PUBLIC_ORIGIN, env.OPENSIGHT_PUBLIC_ORIGIN, await readFile(join(directory, 'cert.pem')));
  const ready = async () => {
    for (let i = 0; i < 100; i++) { try { if ((await call('/health/ready')).status === 200) return; } catch {} await delay(100); }
    assert.fail('COMPOSE_REFERENCE_NOT_READY');
  };
  await ready(); assert.equal((await call('/')).status, 200);
  t.diagnostic(`H8 Compose measurements: ${JSON.stringify(await exerciseReference(call, actors, env.OPENSIGHT_AUDIT_OPERATOR_KEY))}`);
  compose('restart', 'api'); await ready();
  const metrics = await call('/api/host/metrics', 'GET', undefined, `AuditOperator ${Buffer.from(env.OPENSIGHT_AUDIT_OPERATOR_KEY, 'base64').toString('base64url')}`);
  assert.equal(metrics.body.cache.bytes, 0);
  compose('stop', 'api'); offline('backup');
  compose('down', '--volumes'); compose('up', '-d', '--wait', '--pull', 'never', 'metadata'); offline('initialize'); offline('restore');
  compose('up', '-d', '--no-build', '--pull', 'never', 'api', 'ingress'); await ready();
  assert.equal((await call('/api/session', 'GET', undefined, `Bearer ${actors[0].token}`)).status, 401);
});
