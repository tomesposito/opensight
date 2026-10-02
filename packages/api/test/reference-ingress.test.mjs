import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:https';
import { referenceIngress } from '../dist/reference-ingress.js';
import { environment } from './hosted-helpers.mjs';
import { hostedConfig } from '../dist/hosted-config.js';

test('H8 native TLS ingress serves only allowed static assets and rejects Host/header ambiguity', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'h8-ingress-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const cert = join(dir, 'cert.pem'), key = join(dir, 'key.pem');
  assert.equal(spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' }).status, 0);
  await writeFile(join(dir, 'index.html'), '<main>Synthetic static asset</main>'); await writeFile(join(dir, 'private.json'), '{"private":true}');
  const env = { OPENSIGHT_PUBLIC_ORIGIN: 'https://localhost', OPENSIGHT_WEB_ROOT: dir, OPENSIGHT_TLS_CERT: cert, OPENSIGHT_TLS_KEY: key };
  const server = await referenceIngress(env); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const ca = await readFile(cert);
  const call = (path, headers = { host: 'localhost' }, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, servername: 'localhost', ca, path, method, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on('error', reject); req.end();
  });
  const home = await call('/'); assert.equal(home.status, 200); assert.match(home.body, /Synthetic static/); assert.match(home.headers['strict-transport-security'], /max-age/);
  assert.equal((await call('/', { host: 'untrusted.example' })).status, 421);
  assert.equal((await call('/', ['Host', 'localhost', 'Authorization', 'Bearer first', 'Authorization', 'Bearer second'])).status, 400);
  for (const path of ['/private.json', '/../index.html', '/%2e%2e/index.html', '/index.html?bootstrap=private']) assert.equal((await call(path)).status, 404);
  assert.equal((await call('/', { host: 'localhost' }, 'POST')).status, 404);
  assert.equal((await call('/', { host: 'localhost' }, 'HEAD')).body, '');
  await assert.rejects(referenceIngress({ ...env, OPENSIGHT_PUBLIC_ORIGIN: 'http://localhost' }), /INGRESS_CONFIG_INVALID/);
});
test('H8 environment forbids sharing encryption, embed signing and operator audit keys', () => {
  const env = environment();
  assert.throws(() => hostedConfig({ ...env, OPENSIGHT_EMBED_SESSION_KEY: env.OPENSIGHT_AUTH_ENCRYPTION_KEY }), { code: 'HOSTED_CONFIG_INVALID' });
  assert.throws(() => hostedConfig({ ...env, OPENSIGHT_AUDIT_OPERATOR_KEY: env.OPENSIGHT_OPERATOR_KEY }), { code: 'HOSTED_CONFIG_INVALID' });
  assert.throws(() => hostedConfig({ ...env, OPENSIGHT_AUDIT_OPERATOR_KEY: 'invalid' }), { code: 'HOSTED_CONFIG_INVALID' });
});
