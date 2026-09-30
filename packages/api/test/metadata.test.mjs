import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata } from '../dist/metadata-schema.js';
import { TenantMetadata } from '../dist/metadata.js';
import { insertResource, resourceKinds } from '../dist/metadata-resources.js';
import { MetadataOperator } from '../dist/metadata-operator.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function seed(db, namespaceId = 'one', tenantId = 'a') {
  await db.transaction(async c => {
    await c.query("INSERT INTO h1_tenants VALUES (?, 'active', 1, NULL, NULL, NULL)", [tenantId]);
    await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [namespaceId, tenantId, namespaceId]);
    await c.query('INSERT INTO h1_revisions VALUES (?,?,1,1,1)', [tenantId, namespaceId]);
    await insertResource(c, { tenantId, namespaceId }, { kind: 'user', id: 'admin' }, { name: namespaceId, role: 'administrator' });
  });
}
const login = (repo, namespaceId = 'one', userId = 'admin') => repo.authenticate(null, async () => ({ namespaceId, userId, tenantId: 'ignored-forged-value' }));

test('H1 scoped repositories isolate identical IDs, owners and unknown/foreign errors', async () => {
  const db = new SqliteMetadataDatabase(':memory:');
  try {
    await initializeMetadata(db); await seed(db); await seed(db, 'two', 'b');
    const repo = new TenantMetadata(db, db); let a = await login(repo), b = await login(repo, 'two');
    assert.equal(a.tenantId, 'a');
    for (let context of [a, b]) {
      await repo.put(context, { kind: 'group', id: 'same' }, { name: context.namespaceId, userIds: ['admin'] });
      context = await login(repo, context.namespaceId);
      await repo.put(context, { kind: 'dataset', id: 'same' }, { definition: { label: context.namespaceId }, sources: [] });
      await repo.put(context, { kind: 'analysis', id: 'same' }, { definition: { AnalysisId: 'same', Definition: { DataSetIdentifierDeclarations: [{ Identifier: 'd', DataSetArn: 'portable' }] } }, datasets: [{ kind: 'dataset', id: 'same' }], folderId: null });
      context = await login(repo, context.namespaceId);
      assert.equal((await repo.get(context, { kind: 'user', id: 'admin' })).body.name, context.namespaceId);
      assert.equal((await repo.get(context, { kind: 'group', id: 'same' })).body.name, context.namespaceId);
      assert.equal((await repo.get(context, { kind: 'dataset', id: 'same' })).body.definition.label, context.namespaceId);
      assert.equal((await repo.list(context, 'analysis')).length, 1);
    }
    a = await login(repo); b = await login(repo, 'two');
    await repo.put(b, { kind: 'folder', id: 'foreign' }, { name: 'foreign' });
    for (const id of ['foreign', 'missing']) {
      await assert.rejects(repo.get(a, { kind: 'folder', id }), { code: 'RESOURCE_NOT_FOUND', status: 404 });
      await assert.rejects(repo.remove(a, { kind: 'folder', id }, 1), { code: 'RESOURCE_NOT_FOUND', status: 404 });
    }
    await assert.rejects(repo.get(a, { kind: 'source', id: 'missing', ownerId: 'other' }), { code: 'RESOURCE_NOT_FOUND' });
    await assert.rejects(repo.put(a, { kind: 'folder', id: 'x' }, { name: 'x', tenantId: 'b' }), { code: 'METADATA_INVALID' });
  } finally { await db.close(); }
});

test('H1 every tenant accessor refuses missing or fabricated context', async () => {
  const db = new SqliteMetadataDatabase(':memory:');
  try {
    await initializeMetadata(db); await seed(db);
    const repo = new TenantMetadata(db, db), context = await login(repo);
    for (const bad of [undefined, null, {}, { ...context }, { tenantId: 'a', namespaceId: 'one', userId: 'admin', authorizationRevision: 1 }]) {
      for (const kind of resourceKinds) {
        await assert.rejects(repo.get(bad, { kind, id: 'x' }), { code: 'TENANT_CONTEXT_REQUIRED' });
        await assert.rejects(repo.list(bad, kind), { code: 'TENANT_CONTEXT_REQUIRED' });
        await assert.rejects(repo.put(bad, { kind, id: 'x' }, {}), { code: 'TENANT_CONTEXT_REQUIRED' });
        await assert.rejects(repo.remove(bad, { kind, id: 'x' }, 1), { code: 'TENANT_CONTEXT_REQUIRED' });
      }
      await assert.rejects(repo.revisions(bad), { code: 'TENANT_CONTEXT_REQUIRED' });
      await assert.rejects(repo.batch(bad, []), { code: 'TENANT_CONTEXT_REQUIRED' });
      await assert.rejects(repo.assertRevisions(bad, {}), { code: 'TENANT_CONTEXT_REQUIRED' });
    }
    await assert.rejects(repo.authenticate(null, async () => undefined), { code: 'PRINCIPAL_REQUIRED' });
    await assert.rejects(login(repo, 'two'), { code: 'UNKNOWN_PRINCIPAL' });
  } finally { await db.close(); }
});

test('H1 foreign keys and optimistic concurrent writes roll back entire batches', async () => {
  const db = new SqliteMetadataDatabase(':memory:');
  try {
    await initializeMetadata(db); await seed(db); await seed(db, 'two', 'b');
    const repo = new TenantMetadata(db, db); let a = await login(repo); const b = await login(repo, 'two');
    await repo.put(b, { kind: 'user', id: 'foreign' }, { name: 'Foreign', role: 'reader' });
    await assert.rejects(repo.batch(a, [
      { key: { kind: 'folder', id: 'rollback' }, body: { name: 'Rollback' }, expectedVersion: 0 },
      { key: { kind: 'group', id: 'bad' }, body: { name: 'Bad', userIds: ['foreign'] }, expectedVersion: 0 }
    ]), { code: 'METADATA_REFERENCE_INVALID' });
    assert.deepEqual(await repo.list(a, 'folder'), []);
    assert.deepEqual(await repo.list(a, 'group'), []);
    await repo.put(a, { kind: 'folder', id: 'race' }, { name: 'original' });
    a = await login(repo);
    const results = await Promise.allSettled(['first', 'second'].map(name => repo.put(a, { kind: 'folder', id: 'race' }, { name }, 1)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'AUTHORIZATION_REVISED');
    a = await login(repo);
    assert.equal((await repo.get(a, { kind: 'folder', id: 'race' })).version, 2);
    await repo.put(a, { kind: 'group', id: 'depends' }, { name: 'Depends', userIds: ['admin'] });
    a = await login(repo);
    await assert.rejects(repo.remove(a, { kind: 'user', id: 'admin' }, 1), { code: 'METADATA_REFERENCE_INVALID' });
  } finally { await db.close(); }
});

test('H1 revisions revoke old contexts and detect configuration changes after asynchronous work', async () => {
  const db = new SqliteMetadataDatabase(':memory:');
  try {
    await initializeMetadata(db); await seed(db);
    const repo = new TenantMetadata(db, db); let context = await login(repo);
    const initial = await repo.revisions(context);
    await repo.put(context, { kind: 'dataset', id: 'sales' }, { definition: {}, sources: [] });
    await assert.rejects(repo.assertRevisions(context, initial), { code: 'METADATA_REVISED' });
    await repo.put(context, { kind: 'policy', id: 'sales' }, { datasetId: 'sales', dataSetArn: 'portable', rowLevel: true, rowRules: [] });
    await assert.rejects(repo.list(context, 'dataset'), { code: 'AUTHORIZATION_REVISED' });
    context = await login(repo);
    assert.deepEqual(await repo.revisions(context), { authorization: 2, policy: 2, configuration: 2 });
    await assert.rejects(repo.put(context, { kind: 'group', id: 'bad' }, { name: 'Bad', userIds: ['missing'] }), { code: 'METADATA_REFERENCE_INVALID' });
    assert.deepEqual(await repo.revisions(context), { authorization: 2, policy: 2, configuration: 2 });
  } finally { await db.close(); }
});

test('H1 tenant/namespace uniqueness and composite foreign keys survive rollback', async () => {
  const db = new SqliteMetadataDatabase(':memory:');
  try {
    await initializeMetadata(db);
    await db.transaction(async c => {
      for (const t of ['a', 'b']) await c.query("INSERT INTO h1_tenants VALUES (?, 'provisioning', 1, NULL, NULL, NULL)", [t]);
      await c.query("INSERT INTO h1_namespaces VALUES ('one', 'a', 'One')");
    });
    for (const sql of ["INSERT INTO h1_namespaces VALUES ('two', 'a', 'Two')", "INSERT INTO h1_namespaces VALUES ('one', 'b', 'One')"])
      await assert.rejects(db.transaction(c => c.query(sql)), { code: 'METADATA_CONFLICT' });
    await assert.rejects(db.transaction(c => c.query("INSERT INTO h1_revisions VALUES ('b','one',1,1,1)")), { code: 'METADATA_REFERENCE_INVALID' });
    await db.transaction(async c => assert.equal((await c.query('SELECT * FROM h1_namespaces')).length, 1));
  } finally { await db.close(); }
});

test('H1 resumable operator lifecycle, suspension revocation and permanent deletion tombstone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-h1-'));
  let db = new SqliteMetadataDatabase(join(dir, 'metadata.db'));
  try {
    await initializeMetadata(db);
    let operator = new MetadataOperator(db), repo = new TenantMetadata(db, db);
    const request = { namespaceId: 'one', name: 'One', administrator: { id: 'admin', name: 'Admin' } };
    const created = await operator.provision('provision', request);
    assert.match(created.tenantId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(await operator.provision('provision', request), created);
    await assert.rejects(operator.provision('provision', { ...request, namespaceId: 'two' }), { code: 'OPERATION_ID_REUSED' });
    await assert.rejects(login(repo), { code: 'UNKNOWN_PRINCIPAL' });
    await assert.rejects(operator.activate('provision'), { code: 'OPERATION_TRANSITION_INVALID' });
    await operator.checkpoint('provision', 'created', 'configured');
    await db.close(); db = new SqliteMetadataDatabase(join(dir, 'metadata.db'));
    operator = new MetadataOperator(db); repo = new TenantMetadata(db, db);
    assert.equal((await operator.inspect('provision')).step, 'configured');
    await operator.checkpoint('provision', 'configured', 'verified');
    await operator.activate('provision');
    const context = await login(repo);
    const suspended = await operator.transition('suspend', created.tenantId, 'suspend', 2);
    assert.deepEqual(await operator.transition('suspend', created.tenantId, 'suspend', 2), suspended);
    await assert.rejects(repo.list(context, 'user'), { code: 'TENANT_UNAVAILABLE' });
    await operator.transition('resume', created.tenantId, 'resume', 3);
    await assert.rejects(repo.list(context, 'user'), { code: 'AUTHORIZATION_REVISED' });
    assert.equal((await repo.revisions(await login(repo))).authorization, 3);
    await operator.transition('delete', created.tenantId, 'delete', 4);
    await assert.rejects(login(repo), { code: 'UNKNOWN_PRINCIPAL' });
    await assert.rejects(operator.finishDeletion('delete'), { code: 'OPERATION_TRANSITION_INVALID' });
    await operator.checkpoint('delete', 'revoked', 'artifacts-removed');
    await operator.finishDeletion('delete');
    assert.equal((await operator.tenant(created.tenantId)).state, 'deleted');
    assert.ok((await operator.tenant(created.tenantId)).tombstone);
    await operator.finishDeletion('delete');
    await assert.rejects(operator.transition('resurrect', created.tenantId, 'resume', 6), { code: 'OPERATION_TRANSITION_INVALID' });
    await assert.rejects(operator.provision('reuse-namespace', request), { code: 'METADATA_CONFLICT' });
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('H1 concurrent provisioning has one winner and no orphan tenant or operation', async () => {
  const db = new SqliteMetadataDatabase(':memory:');
  try {
    await initializeMetadata(db); const operator = new MetadataOperator(db);
    const results = await Promise.allSettled(['first', 'second'].map(id => operator.provision(id, { namespaceId: 'same', name: 'Same', administrator: { id: 'admin', name: 'Admin' } })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'METADATA_CONFLICT');
    await db.transaction(async c => {
      for (const table of ['tenants', 'namespaces', 'operations', 'resources', 'revisions']) assert.equal((await c.query(`SELECT * FROM h1_${table}`)).length, 1);
    });
  } finally { await db.close(); }
});

test('H1 outbox commits with state, contains no payloads, and rolls back on failure', async () => {
  const db = new SqliteMetadataDatabase(':memory:');
  try {
    await initializeMetadata(db); await seed(db);
    const repo = new TenantMetadata(db, db), context = await login(repo);
    await repo.put(context, { kind: 'dataset', id: 'd' }, { definition: { Name: 'private payload' }, sources: [] });
    const readEvents = () => db.transaction(c => c.query('SELECT * FROM h1_outbox'));
    const before = await readEvents();
    assert.equal(before.length, 1); assert.equal(before[0].event_type, 'metadata.changed');
    assert.equal(JSON.stringify(before).includes('private payload'), false);
    await assert.rejects(repo.put(context, { kind: 'group', id: 'bad' }, { name: 'bad', userIds: ['missing'] }));
    assert.deepEqual(await readEvents(), before);
    const operator = new MetadataOperator(db), request = { namespaceId: 'new', name: 'New', administrator: { id: 'admin', name: 'Admin' } };
    await operator.provision('new-operation', request); await operator.provision('new-operation', request);
    assert.equal((await readEvents()).length, 2);
  } finally { await db.close(); }
});

test('H1 every resource kind isolates identical IDs and all relational edges reject foreign-only targets', async () => {
  const db = new SqliteMetadataDatabase(':memory:');
  try {
    await initializeMetadata(db); await seed(db); await seed(db, 'two', 'b');
    const repo = new TenantMetadata(db, db);
    const resources = name => [
      [{ kind: 'user', id: 'same' }, { name, role: 'author' }],
      [{ kind: 'group', id: 'same' }, { name, userIds: ['admin', 'same'] }],
      [{ kind: 'folder', id: 'same' }, { name, grants: [{ principal: { type: 'group', id: 'same' }, role: 'viewer' }] }],
      [{ kind: 'source', id: 'same' }, { binding: { name } }],
      [{ kind: 'dataset', id: 'same' }, { definition: { name }, sources: [{ kind: 'source', id: 'same' }] }],
      ...['analysis', 'dashboard'].map(kind => [{ kind, id: 'same' }, { definition: { Name: name, [kind === 'analysis' ? 'AnalysisId' : 'DashboardId']: 'same', Definition: { DataSetIdentifierDeclarations: [{ Identifier: 'd', DataSetArn: 'portable' }] } }, datasets: [{ kind: 'dataset', id: 'same' }], folderId: 'same' }]),
      [{ kind: 'policy', id: 'same' }, { datasetId: 'same', dataSetArn: 'portable', rowLevel: true, rowRules: [{ id: 'same', principals: [{ type: 'group', id: 'same' }], predicate: {} }] }],
      [{ kind: 'secret', id: 'same' }, { ciphertext: [Buffer.alloc(12), Buffer.alloc(16), Buffer.from(name)].map(b => b.toString('base64')).join('.'), aadVersion: 2 }],
      [{ kind: 'ai-config', id: 'same' }, { provider: 'openai', model: name, secretId: 'same' }],
      [{ kind: 'invitation', id: 'same' }, { name, role: 'reader', invitedBy: 'admin', tokenHash: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00Z' }],
      [{ kind: 'job', id: 'same' }, { collection: 'test', record: { name }, references: [{ kind: 'dashboard', id: 'same' }], executionDisabled: true }],
      [{ kind: 'source', id: 'owned', ownerId: 'admin' }, { binding: { name } }],
      [{ kind: 'prepared-dataset', id: 'same', ownerId: 'admin' }, { resource: { resourceType: 'dataset', dataSetId: 'same', name, physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: { version: 1, input: 'owned', steps: [] } } }]
    ];
    for (const ns of ['one', 'two']) {
      await repo.batch(await login(repo, ns), resources(ns).map(([key, body]) => ({ key, body, expectedVersion: 0 })));
      const context = await login(repo, ns);
      for (const [key, body] of resources(ns)) {
        assert.deepEqual((await repo.get(context, key)).body, body);
        const listed = await repo.list(context, key.kind);
        assert.deepEqual(listed.find(v => v.id === key.id && v.ownerId === key.ownerId).body, body);
      }
      const author = await login(repo, ns, 'same');
      assert.deepEqual(await repo.list(author, 'prepared-dataset'), []);
      await assert.rejects(repo.get(author, { kind: 'prepared-dataset', id: 'same', ownerId: 'admin' }), { code: 'RESOURCE_NOT_FOUND' });
    }
    // The same target exists in tenant two only, and cannot satisfy tenant one's FK.
    const a = await login(repo), b = await login(repo, 'two');
    await repo.put(b, { kind: 'source', id: 'foreign' }, { binding: {} });
    await assert.rejects(repo.put(a, { kind: 'dataset', id: 'bad' }, { definition: {}, sources: [{ kind: 'source', id: 'foreign' }] }), { code: 'METADATA_REFERENCE_INVALID' });
    // Raw composite constraints, independent of JSON/application validation.
    for (const kind of resourceKinds) await assert.rejects(db.transaction(c => c.query('INSERT INTO h1_resources VALUES (?,?,?,?,?,?,?)', ['b', 'one', kind, kind === 'prepared-dataset' ? 'admin' : '', 'bypass', '{}', 1])), { code: 'METADATA_REFERENCE_INVALID' });
    await assert.rejects(db.transaction(c => c.query('INSERT INTO h1_links VALUES (?,?,?,?,?,?,?,?)', ['a', 'one', 'dataset', '', 'same', 'source', '', 'foreign'])), { code: 'METADATA_REFERENCE_INVALID' });
  } finally { await db.close(); }
});
