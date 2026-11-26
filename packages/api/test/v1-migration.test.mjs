import test from 'node:test';
import assert from 'node:assert/strict';
import { authFixture } from './hosted-helpers.mjs';
import { serving } from './v1-helpers.mjs';
import { TenantMetadata } from '../dist/metadata.js';
import { readerMember } from './embed-content-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { importBundle } from '@opensight/web/import';
import { serializeImportReport } from '@opensight/bundle-parser';
export const bundle = (definition = { dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 'sheet', visuals: [] }] }) => ({ members: [
  { path: 'analysis/synthetic.json', resource: { resourceType: 'analysis', analysisId: 'synthetic', name: 'Synthetic analysis', definition } },
] });
const base = '/api/v1/bundle-imports';
async function setup(t, env = {}) {
  const f = await authFixture(t), call = await serving(t, f, env), metadata = new TenantMetadata(f.db, f.db);
  let token = (await f.login()).token;
  const identity = await f.auth.verify(token);
  return { ...f, call, metadata, identity, context: () => metadata.authenticate(null, async () => identity),
    renew: async () => { token = (await f.login()).token; }, request: (path, o = {}) => call(path, { token, ...o }) };
}
const post = body => ({ method: 'POST', body });

test('D-97 v1 import atomically stores working analyses and identical member-owned report across server restart', async t => {
  const f = await setup(t), body = { importId: 'migration', bundle: bundle() };
  const r = await f.request(base, { ...post(body), headers: { 'Idempotency-Key': 'one' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.targets, [{ asset: 0, state: 'imported', analysisId: 'migration-0' }]);
  assert.deepEqual((await f.request(`${base}/migration/report`)).body, r.body.report);
  const expected = serializeImportReport(importBundle(body.bundle).bundle.report, { generatedAt: r.body.report.generatedAt });
  assert.deepEqual(r.body.report, expected);
  const restarted = await serving(t, f);
  assert.deepEqual((await restarted(`${base}/migration/report`, { token: (await f.login()).token })).body, r.body.report);
  const replay = await f.request(base, { ...post(body), headers: { 'Idempotency-Key': 'one' } });
  assert.equal(replay.status, 201); assert.equal(replay.headers['idempotent-replayed'], 'true'); assert.deepEqual(replay.body, r.body);
  assert.equal((await f.request(base, { ...post({ ...body, importId: 'different' }), headers: { 'Idempotency-Key': 'one' } })).body.errorCode, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.request(base, post(body))).body.errorCode, 'MIGRATION_IMPORT_CONFLICT');
  assert.equal((await f.request('/api/v1/analyses/migration-0')).status, 200);
});

test('D-97 report read refuses another tenant, member including administrator, reader, fabricated owner and missing auth', async t => {
  const f = await setup(t), member = await readerMember(f); await f.renew();
  assert.equal((await f.request(base, post({ importId: 'private', bundle: bundle() }))).status, 201);
  const path = `${base}/private/report`;
  assert.equal((await f.call(path)).status, 401);
  const reader = await f.call(path, { token: (await member.login()).token }); assert.equal(reader.status, 403);
  const ctx = await f.context();
  await f.metadata.put(ctx, { kind: 'user', id: member.identity.userId }, { name: 'Second administrator', role: 'administrator' }, 1);
  const admin = await f.call(path, { token: (await member.login()).token }); assert.equal(admin.status, 404);
  const other = await setup(t); assert.equal((await f.call(path, { token: (await other.login()).token })).status, 401);
  await assert.rejects(f.metadata.importReport({ ...ctx }, 'private'), { code: 'TENANT_CONTEXT_REQUIRED' });
  await f.renew();
  assert.equal((await f.request(base, post({ importId: 'bad', bundle: bundle(), ownerId: member.identity.userId }))).status, 400);
  assert.equal((await f.request(base, post({ importId: 'bad', bundle: bundle(), tenantId: 'another' }))).status, 400);
  // A verified identity in another tenant on the SAME database is also unable to read.
  const tenant = await f.provisioning.provision('other-tenant', { ...f.input, name: 'Other', displayName: 'Other' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  await f.auth.accept(invitation, f.password, f.code(), 'local'); f.advance();
  const session = await f.auth.login(f.email, f.password, f.code(), tenant.tenantId, 'local'); f.advance();
  assert.equal((await f.call(path, { token: session.token })).status, 404);

});

test('D-97 unsupported and unresolved constructs remain staged, fingerprinted and never executable', async t => {
  const f = await setup(t);
  const d = { dataSetIdentifierDeclarations: [{ identifier: 'foreign', dataSetArn: 'urn:synthetic:dataset' }], sheets: [{ sheetId: 's', visuals: [{ insightVisual: { visualId: 'v', insightConfiguration: { computations: [{ anomaly: { computationId: 'x' } }] } } }] }] };
  const r = await f.request(base, post({ importId: 'blocked', bundle: bundle(d) }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.targets, [{ asset: 0, state: 'staged' }]);
  assert.ok(r.body.report.assets[0].coverage.failedClosed.count > 0);
  assert.ok(r.body.report.groups.some(g => g.kind === 'visual:anomaly'));
  assert.equal((await f.request('/api/v1/analyses/blocked-0')).status, 404);
  assert.doesNotMatch(JSON.stringify(r.body.report), /urn:synthetic|Synthetic analysis|computationId|foreign/);
  const repeated = await f.request(base, post({ importId: 'again', bundle: bundle(d), previousImportId: 'blocked' }));
  assert.ok(repeated.body.report.groups.every(g => !g.newKind));
});

test('D-97 bad bundles, credential material, invalid manifests and binding bypasses write nothing', async t => {
  const f = await setup(t);
  for (const body of [
    { bundle: { members: [] } }, { bundle: { ...bundle(), credentials: { password: 'synthetic' } } },
    { manifest: { artifact: 'extraction-manifest', schemaVersion: 999 } },
    { bindings: [{ asset: 5, datasetBindings: {} }] },
    { bindings: [{ asset: 0, datasetBindings: { unexpected: { kind: 'dataset', id: 'x' } } }] },
  ]) {
    const r = await f.request(base, post({ importId: 'invalid', bundle: bundle(), ...body }));
    assert.ok([400, 422].includes(r.status), JSON.stringify(r.body));
    assert.equal((await f.request(`${base}/invalid/report`)).status, 404);
  }
  const current = await f.context();
  assert.equal((await f.metadata.list(current, 'migration-import')).length, 0);
  assert.equal((await f.metadata.list(current, 'analysis')).length, 0);
});

test('D-97 import uses normal binding admission and rolls back report plus all analyses on collision', async t => {
  const f = await setup(t);
  const source = await f.request('/api/uploads', post(upload())); assert.equal(source.status, 201); await f.renew();
  const prep = await f.request('/api/datasets/sales/prep', { method: 'PUT', body: { name: 'Sales', pipeline: { version: 1, input: source.body.id, steps: [] }, expectedVersion: 0 } });
  assert.equal(prep.status, 200); await f.renew();
  const d = { dataSetIdentifierDeclarations: [{ identifier: 'data', dataSetArn: 'urn:synthetic:data' }], sheets: [{ sheetId: 'sheet', visuals: [] }] };
  const r = await f.request(base, post({ importId: 'bound', bundle: bundle(d), bindings: [{ asset: 0, datasetBindings: { data: { kind: 'prepared-dataset', id: 'sales' } } }] }));
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.targets[0].state, 'imported');
  assert.ok(r.body.report.assets[0].findings.find(f => f.construct === 'dataSetIdentifierDeclarations' && f.outcome === 'clean'));
  const missing = await f.request(base, post({ importId: 'missing', bundle: bundle(d), bindings: [{ asset: 0, datasetBindings: { data: { kind: 'prepared-dataset', id: 'unresolved' } } }] }));
  assert.equal(missing.status, 404); assert.equal((await f.request(`${base}/missing/report`)).status, 404);
  const first = bundle().members[0], second = { path: 'analysis/second.json', resource: { ...first.resource, analysisId: 'second' } };
  await f.request('/api/v1/analyses', post({ analysisId: 'collision-1', name: 'Existing', definition: first.resource.definition, datasetBindings: {} }));
  const collision = await f.request(base, post({ importId: 'collision', bundle: { members: [first, second] } }));
  assert.equal(collision.status, 409, JSON.stringify(collision.body));
  assert.equal((await f.request('/api/v1/analyses/collision-0')).status, 404);
  assert.equal((await f.request(`${base}/collision/report`)).status, 404);
});

import { coordinationFixture } from './coordination-helpers.mjs';
import { migrateV1Durable } from '../dist/v1-durable-schema.js';
import { DurableV1 } from '../dist/v1-durable.js';
test('D-97 durable retry receipt commits with import and rolls every write back on receipt failure', async t => {
  const f = await coordinationFixture(t); await migrateV1Durable(f.db, 'test', 'sqlite'); await f.open();
  const context = f.contexts[0], report = serializeImportReport(importBundle(bundle()).bundle.report);
  const write = { id: 'atomic', record: { bundle: bundle(), report, targets: [{ asset: 0, state: 'imported', analysisId: 'atomic-0' }] },
    analyses: [{ id: 'atomic-0', name: 'Synthetic', definition: bundle().members[0].resource.definition, datasetBindings: {}, version: 1 }] };
  const store = () => new DurableV1(f.db, f.metadata, context, 'test', {}, 'sqlite');
  const receipt = await store().reserve(context.tenantId, 'migration-once'); receipt.prepare({ importId: write.id, report });
  const stamp = await f.metadata.revisions(context);
  await assert.rejects(f.metadata.importBundle(context, write, stamp, { persist: async c => { await receipt.persist(c); throw Error('interrupted'); } }), /interrupted/);
  await assert.rejects(f.metadata.importReport(context, 'atomic'), { code: 'RESOURCE_NOT_FOUND' });
  await assert.rejects(f.metadata.get(context, { kind: 'analysis', id: 'atomic-0' }), { code: 'RESOURCE_NOT_FOUND' });
  assert.equal(await store().get('migration-once'), undefined);
  await f.metadata.importBundle(context, write, stamp, receipt);
  assert.deepEqual(await store().get('migration-once'), { importId: write.id, report });
  assert.deepEqual(await f.metadata.importReport(context, write.id), report);
});
