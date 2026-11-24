import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { auditSource } from '../../mcp-server/scripts/generate.mjs';
import { workspaceAuditAction, recordWorkspaceAction } from '../dist/workspace-audit.js';
import { AUDIT_REDACTED, appendOperatorAudit, assertAuditReady, readOperatorAudit, readWorkspaceAudit } from '../dist/operator-audit.js';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { createHostedApiServer, drainHostedServer } from '../dist/hosted-server.js';

test('#330 audit operation inventory covers every OpenAPI method and uses safe route names', () => {
  const spec = load(readFileSync(new URL('../../../docs/api/openapi-v1.yaml', import.meta.url), 'utf8'));
  assert.equal(readFileSync(new URL('../src/v1-audit-operations.ts', import.meta.url), 'utf8'), auditSource(spec));
  for (const [path, item] of Object.entries(spec.paths)) for (const [verb, operation] of Object.entries(item)) {
    if (!operation.operationId || operation.operationId === 'list_workspace_action_history') continue;
    const action = workspaceAuditAction(verb.toUpperCase(), `/api/v1${path.replaceAll(/\{[^}]+\}/g, 'synthetic')}`);
    assert.equal(action.operationId, operation.operationId);
  }
  assert.deepEqual(workspaceAuditAction('POST', '/api/v1/datasets/sales/query'), {
    action: 'run_dataset_query', operationId: 'run_dataset_query', subject: 'sales',
  });
  assert.equal(workspaceAuditAction('PATCH', '/api/v1/datasets/sales').action, 'PATCH /api/v1/datasets/{id}');
  assert.equal(workspaceAuditAction('GET', '/api/v1/unknown/secret-text').action, 'GET /api/v1/{unmatched}');
  assert.equal(workspaceAuditAction('GET', '/api/v1/workspace/action-history'), undefined);
  assert.equal(workspaceAuditAction('GET', '/api/session'), undefined);
});

test('#330 hosted v1 success and failure are recorded once with member identity and no body or credentials', async t => {
  const f = await h8Fixture(t), s = await serveH8(t, f);
  const headers = { authorization: 'one' };
  const success = await s.request('/api/v1/analyses', { headers });
  assert.equal(success.status, 200);
  const denied = await s.request('/api/v1/analyses', { method: 'POST', headers,
    body: { analysisId: 'secret-body', name: 'secret-body', definition: { ownerId: 'forged-secret' }, datasetBindings: {} } });
  assert.equal(denied.status, 422, JSON.stringify(denied));
  assert.equal(denied.body.errorCode, 'SECURITY_REJECTED');
  await drainHostedServer(s.server);
  const entries = (await readOperatorAudit(f.db, { limit: 200 })).filter(e => e.action === 'list_analyses' || e.action === 'create_analysis');
  assert.equal(entries.length, 2);
  for (const e of entries) {
    assert.equal(e.actor, 'admin'); assert.equal(e.tenantId, 'tenant-one'); assert.equal(e.subject, null);
    const status = e.action === 'list_analyses' ? 200 : 422;
    assert.deepEqual(e.detail, { operationId: e.action, method: status === 200 ? 'GET' : 'POST', outcome: status === 200 ? 'success' : 'denied', status });
  }
  assert.doesNotMatch(JSON.stringify(entries), /secret-body|forged-secret|authorization|definition|datasetBindings/);
});

test('#330 audit migration is required at startup; later append failures are diagnosed without throwing', async t => {
  const f = await h8Fixture(t);
  await assertAuditReady(f.db);
  await f.db.transaction(c => c.query('DROP TABLE h8_audit'));
  await assert.rejects(assertAuditReady(f.db), { code: 'AUDIT_SCHEMA_NOT_MIGRATED' });
  await assert.rejects(createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, env: f.env,
    security: { authenticate: async () => undefined } }), { code: 'AUDIT_SCHEMA_NOT_MIGRATED' });
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  await recordWorkspaceAction(f.db, { tenantId: 'tenant-one', userId: 'admin' },
    workspaceAuditAction('GET', '/api/v1/analyses'), 'GET', 200);
  assert.deepEqual(logs, [['WORKSPACE_AUDIT_APPEND_FAILED', 'AUDIT_SCHEMA_NOT_MIGRATED']]);
});

test('#330 workspace audit bounds, stable paging and tenant isolation include other members but exclude NULL tenants', async t => {
  const f = await h8Fixture(t), now = Date.UTC(2026, 10, 24);
  await f.db.transaction(async c => {
    for (let i = 0; i < 205; i++) await appendOperatorAudit(c, { action: 'list_datasets', actor: i % 2 ? 'member' : 'admin', tenantId: 'tenant-one' }, now + Math.floor(i / 2));
    await appendOperatorAudit(c, { action: 'other-tenant', tenantId: 'tenant-two' }, now + 1000);
    await appendOperatorAudit(c, { action: 'operator-only' }, now + 2000);
  });
  assert.equal((await readWorkspaceAudit(f.db, 'tenant-one')).items.length, 50);
  const first = await readWorkspaceAudit(f.db, 'tenant-one', { limit: 200 });
  assert.equal(first.items.length, 200); assert.ok(first.nextCursor);
  const rest = await readWorkspaceAudit(f.db, 'tenant-one', { limit: 200, cursor: first.nextCursor });
  assert.equal(rest.items.length, 5); assert.equal(rest.nextCursor, null);
  const all = [...first.items, ...rest.items];
  assert.equal(new Set(all.map(e => e.eventId)).size, 205);
  assert.ok(all.every(e => e.tenantId === 'tenant-one'));
  assert.deepEqual(new Set(all.map(e => e.actor)), new Set(['admin', 'member']));
  assert.deepEqual(all, [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.eventId.localeCompare(a.eventId)));
  assert.equal((await readWorkspaceAudit(f.db, 'tenant-one', { limit: 1 })).items.length, 1);
  for (const limit of [0, -1, 201, 1.5, NaN, Infinity]) await assert.rejects(readWorkspaceAudit(f.db, 'tenant-one', { limit }), { code: 'INVALID_PAGINATION' });
  for (const tenant of ['', undefined, null]) await assert.rejects(readWorkspaceAudit(f.db, tenant), { code: 'METADATA_INVALID' });
  for (const cursor of ['', 'not-json', Buffer.from(JSON.stringify({ tenantId: 'tenant-two' })).toString('base64url')])
    await assert.rejects(readWorkspaceAudit(f.db, 'tenant-one', { cursor }), { code: 'INVALID_PAGINATION' });
  // A cursor from another workspace is only a position, never authority.
  assert.ok((await readWorkspaceAudit(f.db, 'tenant-two', { cursor: first.nextCursor })).items.every(e => e.tenantId === 'tenant-two'));
});

test('#330 member HTTP history is tenant-scoped, paginated, read-only and leaves operator auth unchanged', async t => {
  const f = await h8Fixture(t);
  await f.db.transaction(async c => {
    await appendOperatorAudit(c, { actor: 'admin', action: 'describe_dataset', tenantId: 'tenant-one', subject: 'sales',
      detail: { token: 'never-stored', nested: { password: 'never-stored' }, status: 200 } }, 1000);
    await appendOperatorAudit(c, { actor: 'reader', action: 'list_datasets', tenantId: 'tenant-one' }, 2000);
    await appendOperatorAudit(c, { actor: 'admin', action: 'foreign', tenantId: 'tenant-two' }, 3000);
    await appendOperatorAudit(c, { action: 'operator-only' }, 4000);
    // Reading history requires membership, not author/admin capabilities.
    await c.query("UPDATE h1_resources SET body = ? WHERE namespace_id = 'one' AND kind = 'user' AND resource_id = 'admin'", [JSON.stringify({ name: 'Reader', role: 'reader' })]);
  });
  const s = await serveH8(t, f), path = '/api/v1/workspace/action-history', headers = { authorization: 'one' };
  assert.equal((await s.request(path)).status, 401);
  const first = await s.request(path, { headers: { ...headers, Limit: '1' } });
  assert.equal(first.status, 200); assert.equal(first.body.items[0].actor, 'reader'); assert.ok(first.body.nextCursor);
  const second = await s.request(path, { headers: { ...headers, Limit: '1', Cursor: first.body.nextCursor } });
  assert.equal(second.status, 200); assert.equal(second.body.nextCursor, null);
  assert.equal(second.body.items[0].actor, 'admin'); assert.equal(second.body.items[0].tenantId, 'tenant-one');
  assert.deepEqual(second.body.items[0].detail, { token: AUDIT_REDACTED, nested: { password: AUDIT_REDACTED }, status: 200 });
  const history = await s.request(path, { headers });
  assert.equal(history.body.items.length, 2); assert.ok(history.body.items.every(e => e.tenantId === 'tenant-one'));
  assert.ok((await s.request(path, { headers: { authorization: 'two' } })).body.items.every(e => e.tenantId === 'tenant-two'));
  for (const value of ['0', '201', '1.5', 'bad']) {
    const invalid = await s.request(path, { headers: { ...headers, Limit: value } });
    assert.equal(invalid.status, 400); assert.equal(invalid.body.errorCode, 'INVALID_PAGINATION');
  }
  assert.equal((await s.request(path, { headers: { ...headers, Cursor: 'bad' } })).status, 400);
  assert.equal((await s.request(`${path}?tenantId=tenant-two`, { headers })).status, 400);
  assert.equal((await s.request(path, { headers: { ...headers, 'x-tenant-id': 'tenant-two' } })).body.errorCode, 'FORGED_PRINCIPAL');
  assert.equal((await s.request('/api/namespaces/two/v1/workspace/action-history', { headers })).status, 404);
  const operator = await s.request('/api/host/audit', { headers });
  assert.equal(operator.status, 403); assert.equal(operator.body.errorCode, 'OPERATOR_REQUIRED');
  assert.equal((await s.request('/api/host/audit', { headers: s.operator })).body.entries.length, 4);
  assert.equal((await readOperatorAudit(f.db, { limit: 200 })).length, 4, 'history reads never audit themselves');
  const denied = await s.request('/api/v1/analyses', { headers, method: 'POST', body: { analysisId: 'denied', name: 'Denied', definition: { dataSetIdentifierDeclarations: [], sheets: [], calculatedFields: [], filterGroups: [] }, datasetBindings: {} } });
  assert.equal(denied.status, 403);
  await drainHostedServer(s.server);
  const entry = (await readWorkspaceAudit(f.db, 'tenant-one')).items[0];
  assert.equal(entry.action, 'create_analysis'); assert.equal(entry.actor, 'admin'); assert.equal(entry.detail.status, 403);
});

test('#330 a runtime audit failure preserves the action response and history fails with a named migration error', async t => {
  const f = await h8Fixture(t), s = await serveH8(t, f);
  await f.db.transaction(c => c.query('DROP TABLE h8_audit'));
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  assert.equal((await s.request('/api/v1/analyses', { headers: { authorization: 'one' } })).status, 200);
  const history = await s.request('/api/v1/workspace/action-history', { headers: { authorization: 'one' } });
  assert.equal(history.status, 503); assert.equal(history.body.errorCode, 'AUDIT_SCHEMA_NOT_MIGRATED');
  await drainHostedServer(s.server);
  assert.deepEqual(logs, [['WORKSPACE_AUDIT_APPEND_FAILED', 'AUDIT_SCHEMA_NOT_MIGRATED']]);
});
