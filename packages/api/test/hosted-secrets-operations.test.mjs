import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sourceFixture, registration, endpoints } from './source-helpers.mjs';
import { HostedSources } from '../dist/hosted-sources.js';
import { safeEvent, auditWriter, initializeEvents } from '../dist/hosted-events.js';
import { assertEncryptionKey, rotateEncryptionKey } from '../dist/hosted-key-rotation.js';
import { initializeAuth } from '../dist/auth-schema.js';

test('H8 telemetry is an allowlist: no auth, bootstrap URLs, connection strings, SQL, rows, prompts or raw errors', () => {
  const forbidden = 'synthetic-private-value';
  const event = safeEvent({ operation: 'request', outcome: 'failed', errorCode: `postgres://${forbidden}`, headers: { authorization: forbidden }, url: `https://example.test/#${forbidden}`, sql: forbidden, rows: [forbidden], prompt: forbidden, error: new Error(forbidden), requestId: `/${forbidden}`, usage: { sql: forbidden, sourceRows: 3 } });
  assert.equal(JSON.stringify(event).includes(forbidden), false); assert.equal(event.usage.sourceRows, 3);
});
test('H8 encrypted references resolve only under current tenant/owner authority and audit contains no values', async t => {
  const f = await sourceFixture(t); await initializeEvents(f.db);
  const sources = new HostedSources(f.metadata, f.key, endpoints, Date.now, auditWriter(f.db));
  const raw = registration(), a = await f.login(); await sources.create(a, 'source', raw);
  assert.deepEqual(await sources.payload(a, await sources.get(a, 'source')), raw.credentials);
  const b = await f.login('two'); await assert.rejects(sources.payload(b, await sources.get(a, 'source')), { code: 'RESOURCE_NOT_FOUND' });
  await assert.rejects(sources.payload({ ...a }, await sources.get(a, 'source')), { code: 'TENANT_CONTEXT_REQUIRED' });
  const rows = await f.db.transaction(c => c.query('SELECT body FROM h8_audit'));
  assert.equal(rows.length, 1); assert.equal(JSON.stringify(rows).includes(raw.credentials.password), false);
});
test('H8 offline encryption rotation is atomic, versioned, auditable, and rejects stale/wrong keys', async t => {
  const f = await sourceFixture(t); await initializeAuth(f.db); await assertEncryptionKey(f.db, f.key);
  const a = await f.login(), raw = registration(); await f.sources.create(a, 'source', raw);
  const next = randomBytes(32).toString('base64');
  await assert.rejects(rotateEncryptionKey(f.db, f.key, next), { code: 'REFERENCE_MAINTENANCE_REQUIRED' });
  await assert.rejects(rotateEncryptionKey(f.db, next, f.key, 'frozen'), { code: 'ENCRYPTION_KEY_VERSION_MISMATCH' });
  await rotateEncryptionKey(f.db, f.key, next, 'frozen');
  await assert.rejects(assertEncryptionKey(f.db, f.key), { code: 'ENCRYPTION_KEY_VERSION_MISMATCH' });
  await assertEncryptionKey(f.db, next);
  const fresh = new HostedSources(f.metadata, next, endpoints); assert.deepEqual(await fresh.payload(a, await fresh.get(a, 'source')), raw.credentials);
  await assert.rejects(f.sources.payload(a, await f.sources.get(a, 'source')), { code: 'SOURCE_SECRET_UNAVAILABLE' });
  const record = await f.db.transaction(c => c.query('SELECT body FROM h8_audit'));
  assert.equal(JSON.parse(record[0].body).operation, 'key.rotate'); assert.equal(JSON.stringify(record).includes(next), false);
});
