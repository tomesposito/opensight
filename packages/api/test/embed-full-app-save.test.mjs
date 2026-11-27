import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request, prepared, input } from './embed-full-app-helpers.mjs';
test('full-app real editor API saves repeatedly in the same session, preserves CAS and can reopen', async t => {
  const f = await fixture(t); await prepared(f);
  const active = await f.open('/analyses/author');
  const before = await f.metadata.revisions(await f.context());
  const created = await active.app('/api/v1/analyses', 'POST', input());
  assert.equal(created.status, 201, JSON.stringify(created.body)); assert.equal(created.headers.etag, '"1"');
  const { analysisId, ...edit } = input(); edit.name = 'Edited in the real editor';
  const saved = await active.app('/api/v1/analyses/working', 'PUT', edit, { 'if-match': '"1"' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(saved.headers.etag, '"2"');
  assert.equal((await active.app('/api/v1/analyses/working', 'PUT', edit, { 'if-match': '"1"' })).body.errorCode, 'METADATA_CONFLICT');
  assert.equal((await active.app('/analysis/working')).body.version, 2);
  assert.equal((await active.app('/route', 'POST', { path: '/analyses/author/working' })).status, 200);
  assert.equal((await f.call(`${active.root}/status`, 'GET', undefined, active.auth)).status, 200);
  assert.deepEqual(await f.metadata.revisions(await f.context()), before);
  assert.equal((await active.app('/api/v1/analyses/working', 'PUT', { ...edit, name: 'Keep working' }, { 'if-match': '"2"' })).headers.etag, '"3"');
});

for (const change of ['revocation', 'config', 'authorization', 'policy', 'suspension']) {
  test(`full-app save fails closed after ${change}`, async t => {
    const f = await fixture(t); await prepared(f);
    const active = await f.open('/analyses/author');
    assert.equal((await active.app('/api/v1/analyses', 'POST', input())).status, 201);
    if (change === 'revocation') await f.sessions.revoke(await f.context(), active.issued.sessionId);
    if (change === 'config') { const config = await f.embedding.get(await f.context()); await f.embedding.put(await f.context(), config.config, config.revision); }
    if (change === 'authorization') {
      const user = await f.metadata.get(await f.context(), { kind: 'user', id: f.reader.identity.userId });
      await f.metadata.put(await f.context(), { kind: 'user', id: user.id }, { ...user.body, name: 'Changed by another principal' }, user.version);
    }
    if (change === 'policy') await f.db.transaction(c => c.query('UPDATE h1_revisions SET policy = policy + 1 WHERE tenant_id = ?', [f.tenant.tenantId]));
    if (change === 'suspension') { const tenant = await f.provisioning.operator.tenant(f.tenant.tenantId); await f.provisioning.transition('suspend-full-app', f.tenant.tenantId, 'suspend', tenant.version); }
    const { analysisId, ...body } = input();
    const saved = await active.app('/api/v1/analyses/working', 'PUT', { ...body, name: 'Must not save' }, { 'if-match': '"1"' });
    assert.equal(saved.body.errorCode, 'EMBED_SESSION_REVOKED');
    const stored = await f.db.transaction(c => c.query("SELECT version FROM h1_resources WHERE kind = 'analysis' AND resource_id = 'working'"));
    assert.equal(Number(stored[0].version), 1);
  });
}

test('full-app commit guard catches revocation after request admission without changing fixed sessions', async t => {
  const f = await fixture(t); await prepared(f);
  const active = await f.open('/analyses/author');
  const verified = await f.sessions.verify(active.issued.sessionId, active.auth.slice(6));
  f.sessions.protectAppWrites(verified.context, active.issued.sessionId, active.auth.slice(6));
  const stamp = await f.metadata.revisions(verified.context);
  await f.sessions.revoke(await f.context(), active.issued.sessionId);
  await assert.rejects(f.metadata.mutateAnalysis(verified.context, 'late-save', { definition: { AnalysisId: 'late-save', Name: 'Late', Definition: { Sheets: [] } }, datasets: [{ kind: 'prepared-dataset', id: 'prepared', ownerId: f.identity.userId }] }, 0, stamp), { code: 'EMBED_SESSION_REVOKED' });
  await assert.rejects(f.metadata.get(await f.context(), { kind: 'analysis', id: 'late-save' }), { code: 'RESOURCE_NOT_FOUND' });
});

