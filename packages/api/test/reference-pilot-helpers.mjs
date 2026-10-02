import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { HostedAuth } from '../dist/hosted-auth.js';
import { HostedProvisioning } from '../dist/hosted-provisioning.js';
import { hostedConfig } from '../dist/hosted-config.js';
import { TenantMetadata } from '../dist/metadata.js';
import { HostedSources } from '../dist/hosted-sources.js';
import { StubMailTransport } from '../dist/mail.js';
import { totp } from '../dist/auth-crypto.js';
import { decode32 } from './hosted-helpers.mjs';

// Trusted offline fixture setup. All probes below use genuine H2 bearer sessions.
export async function seedReference(db, tenantDb, env) {
  const config = hostedConfig(env), metadata = new TenantMetadata(tenantDb, db), mail = new StubMailTransport();
  let now = Math.floor(Date.now() / 30000) * 30000;
  const auth = await HostedAuth.create(db, config, () => now), provision = new HostedProvisioning(db, config, mail, () => now);
  const sources = new HostedSources(metadata, config.encryptionKey.toString('base64'), []), actors = [];
  for (let index = 1; index <= 2; index++) {
    const email = `synthetic-${index}@example.test`, password = randomBytes(24).toString('base64');
    const tenant = await provision.provision(`pilot-${index}`, { name: `Synthetic ${index}`, administrator: { email, name: 'Synthetic administrator' } });
    const invitation = mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
    const enrollment = await auth.enroll(invitation, password, 'local'), secret = decode32(enrollment.secret);
    await auth.accept(invitation, password, totp(secret, Math.floor(now / 30000)), 'local'); now += 30000;
    let session = await auth.login(email, password, totp(secret, Math.floor(now / 30000)), tenant.tenantId, 'local'); now += 30000;
    const context = await metadata.authenticate(session.token, t => auth.verify(t));
    const csv = 'amount\n' + Array.from({ length: 4096 }, () => index).join('\n');
    const upload = await sources.upload(context, { config: { format: 'csv' }, base64: Buffer.from(csv).toString('base64'), policy: { rowLevel: false, rowRules: [] }, expiresAt: '2099-01-01T00:00:00.000Z' });
    const original = await metadata.get(context, { kind: 'source', ownerId: context.userId, id: upload.id });
    await metadata.put(context, { kind: 'source', ownerId: context.userId, id: 'same' }, original.body);
    // An explicitly denied source exercises policy refusal while another tenant floods the node.
    await metadata.put(context, { kind: 'source', ownerId: context.userId, id: 'protected' }, { ...original.body, policy: { rowLevel: true, rowRules: [] } });
    session = await auth.login(email, password, totp(secret, Math.floor(now / 30000)), tenant.tenantId, 'local'); now += 30000;
    actors.push({ token: session.token, tenantId: tenant.tenantId, namespaceId: tenant.namespaceId, expected: index * 4096, foreignSource: upload.id });
  }
  return actors;
}
export function referenceCall(url, origin, ca) {
  return (path, method = 'GET', body, authorization, headers = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body), target = new URL(path, url);
    const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method, ca, headers: {
      host: new URL(origin).host, ...(authorization ? { authorization } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers,
    } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => {
        const bytes = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body: res.headers['content-type']?.includes('application/json') ? JSON.parse(bytes) : bytes });
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error('PILOT_REQUEST_TIMEOUT'))); req.on('error', reject); req.end(data);
  });
}
export async function exerciseReference(call, actors, auditKey) {
  const a = `Bearer ${actors[0].token}`, b = `Bearer ${actors[1].token}`, operator = `AuditOperator ${Buffer.from(auditKey, 'base64').toString('base64url')}`;
  assert.equal((await call('/health/ready')).status, 200);
  assert.equal((await call('/api/sources')).status, 401);
  assert.equal((await call(`/api/namespaces/${actors[1].namespaceId}/sources`, 'GET', undefined, a)).status, 404);
  assert.equal((await call('/api/session', 'GET', undefined, a, { 'x-tenant-id': actors[1].tenantId })).status, 403);
  assert.equal((await call(`/api/sources/${actors[1].foreignSource}`, 'GET', undefined, a)).status, 404);
  const query = { query: { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] } };
  const started = performance.now();
  const flood = Array.from({ length: 12 }, () => call('/api/sources/same/query', 'POST', query, a));
  const [neighbor, denied] = await Promise.all([call('/api/sources/same/query', 'POST', query, b), call('/api/sources/protected/query', 'POST', query, a)]);
  assert.equal(neighbor.status, 200); assert.equal(neighbor.body.rows[0].total, actors[1].expected);
  assert.equal(denied.body.errorCode, 'ROW_ACCESS_DENIED');
  const outcomes = await Promise.all(flood), elapsedMs = performance.now() - started;
  for (const result of outcomes) {
    assert.ok([200, 429].includes(result.status));
    if (result.status === 200) assert.equal(result.body.rows[0].total, actors[0].expected);
    else assert.equal(result.body.errorCode, 'TENANT_BUDGET_EXCEEDED');
  }
  assert.ok(outcomes.some(r => r.status === 429));
  const metaStart = performance.now();
  for (let batch = 0; batch < 10; batch++) {
    const responses = await Promise.all([a, b, a, b].map(token => call('/api/session', 'GET', undefined, token)));
    assert.ok(responses.every(r => r.status === 200));
  }
  const metadataRequestsPerSecond = 40000 / (performance.now() - metaStart);
  const schedule = { kind: 'interval', minutes: 60, timeZone: 'UTC' }, jobStart = performance.now();
  for (const token of [a, b]) {
    assert.equal((await call('/api/jobs/pilot-refresh', 'PUT', { expectedVersion: 0, spec: { kind: 'refresh', target: { kind: 'source', id: 'same' }, enabled: true, schedule } }, token)).status, 200);
    assert.equal((await call('/api/jobs/pilot-refresh/runs', 'POST', {}, token)).status, 202);
  }
  let completed = false;
  while (performance.now() - jobStart < 30000) {
    const runs = await Promise.all([a, b].map(token => call('/api/jobs/pilot-refresh/runs', 'GET', undefined, token)));
    if (runs.every(r => r.body.some(run => run.state === 'succeeded'))) { completed = true; break; }
    await delay(100);
  }
  assert.equal(completed, true);
  const jobsPerSecond = 2000 / (performance.now() - jobStart);
  assert.equal((await call('/api/host/audit', 'GET', undefined, a)).status, 403);
  assert.equal((await call('/api/host/metrics', 'GET', undefined, `Operator ${Buffer.from(auditKey, 'base64').toString('base64url')}`)).status, 403);
  const ownAudit = await call('/api/audit', 'GET', undefined, a); assert.equal(ownAudit.status, 200);
  assert.ok(ownAudit.body.every(e => e.tenantId === actors[0].tenantId));
  const metrics = await call('/api/host/metrics', 'GET', undefined, operator); assert.equal(metrics.status, 200);
  assert.equal(JSON.stringify(metrics.body).includes(actors[0].tenantId), false);
  assert.ok(metrics.body.cache.bytes > 0); assert.ok(metrics.body.cache.bytes <= 67108864);
  const audit = await call('/api/host/audit', 'GET', undefined, operator); assert.equal(audit.status, 200);
  assert.equal(JSON.stringify(audit.body).includes(actors[0].token), false);
  return { concurrentTenants: 2, rowsPerQuery: 4096, floodSubmitted: 12, floodAccepted: outcomes.filter(r => r.status === 200).length,
    floodRejected: outcomes.filter(r => r.status === 429).length, floodElapsedMs: Math.round(elapsedMs),
    queryRequestsPerSecond: Number(((outcomes.filter(r => r.status === 200).length + 1) * 1000 / elapsedMs).toFixed(2)),
    metadataRequestsPerSecond: Number(metadataRequestsPerSecond.toFixed(2)), jobsPerSecond: Number(jobsPerSecond.toFixed(2)),
    blazeBytes: metrics.body.cache.bytes, nodeRssBytes: metrics.body.rssBytes, peakWorkerRssBytes: metrics.body.admission.peakWorkerRssBytes };
}
