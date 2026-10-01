import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture, registration, upload, policy } from './source-helpers.mjs';
import { HostedData } from '../dist/hosted-data.js';
import { HostedPrep } from '../dist/hosted-prep.js';
const protectedPolicy = { rowLevel: true, rowRules: [{ id: 'east', principals: [{ type: 'user', id: 'admin' }], predicate: { column: 'region', operator: 'eq', value: 'east' } }], protectedColumns: ['private'], columnGrants: [] };
const query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
const pipe = input => ({ version: 1, input, steps: [] });

test('H3 discovery, preview, output, query and AI use the same RLS/CLS on uploads and Blaze', async t => {
  const f = await sourceFixture(t), a = await f.login(), data = new HostedData(f.sources, undefined, f.budgets), u = await f.sources.upload(a, upload(protectedPolicy));
  for (const path of ['discovery', 'ai']) assert.deepEqual((await data.schema(a, u.id, path)).columns.map(c => c.name), ['region', 'amount']);
  assert.deepEqual((await data.discover(a))[0].columns.map(c => c.name), ['region', 'amount']);
  await data.refresh(a, u.id);
  for (const mode of ['DIRECT_QUERY', 'BLAZE']) {
    for (const path of ['preview', 'output']) {
      const result = await data.execute(a, u.id, path, { mode });
      assert.deepEqual(result.rows, [{ region: 'east', amount: 10 }, { region: 'east', amount: 30 }]);
      assert.equal(result.rowCount, 2);
      await assert.rejects(data.execute(a, u.id, path, { mode, columns: ['private'] }), { code: 'COLUMN_ACCESS_DENIED' });
    }
    assert.deepEqual((await data.execute(a, u.id, 'query', { mode, query })).rows, [{ total: 40 }]);
    for (const forged of [
      { ...query, dimensions: [{ fieldId: 'secret', columnName: 'private' }] },
      { ...query, filters: [{ columnName: 'private', value: 'a' }] },
      { ...query, calculatedFields: [{ name: 'leak', expression: 'strlen({private})' }], measures: [{ fieldId: 'secret', columnName: 'leak', aggregation: 'SUM' }] },
    ]) await assert.rejects(data.execute(a, u.id, 'query', { mode, query: forged }), { code: 'COLUMN_ACCESS_DENIED' });
  }
});
test('H3 cross-tenant, cross-owner, unresolved policy and forged contexts deny before connector/cache I/O', async t => {
  const f = await sourceFixture(t), a = await f.login(); let io = 0;
  const data = new HostedData(f.sources, async () => { io++; throw new Error('must not open source'); }, f.budgets);
  await f.sources.create(await f.login('two'), 'foreign', registration());
  await f.sources.create(await f.login('one', 'other'), 'other', registration());
  await f.sources.create(a, 'no-rules', { ...registration(), policy: { rowLevel: true, rowRules: [] } });
  await f.sources.create(a, 'protected', { ...registration(), policy: protectedPolicy });
  for (const [id, code] of [['foreign', 'RESOURCE_NOT_FOUND'], ['other', 'RESOURCE_NOT_FOUND'], ['missing', 'RESOURCE_NOT_FOUND'], ['no-rules', 'ROW_ACCESS_DENIED']]) {
    for (const path of ['discovery', 'query', 'preview', 'output', 'ai']) await assert.rejects(data.admit(a, id, path), { code });
    await assert.rejects(data.refresh(a, id), { code });
  }
  await assert.rejects(data.execute(a, 'protected', 'output', { columns: ['private'], mode: 'BLAZE' }), { code: 'COLUMN_ACCESS_DENIED' });
  await assert.rejects(data.execute(a, 'protected', 'query', { query: { ...query, filters: [{ columnName: 'private', value: 'a' }] } }), { code: 'COLUMN_ACCESS_DENIED' });
  await assert.rejects(data.admit({ ...a }, 'protected', 'query'), { code: 'TENANT_CONTEXT_REQUIRED' });
  assert.equal(io, 0);
});
test('H3 source rotation, retirement, expiry and policy changes invalidate cache admission', async t => {
  const f = await sourceFixture(t), a = await f.login(), data = new HostedData(f.sources, undefined, f.budgets), u = await f.sources.upload(a, upload());
  await data.refresh(a, u.id); await f.sources.bind(a, u.id, { expectedVersion: 1, policy: protectedPolicy });
  await assert.rejects(data.execute(a, u.id, 'query', { query, mode: 'BLAZE' }), { code: 'BLAZE_NOT_READY' });
  await data.refresh(a, u.id); assert.deepEqual((await data.execute(a, u.id, 'query', { query, mode: 'BLAZE' })).rows, [{ total: 40 }]);
  await f.sources.retire(a, u.id, 2);
  await assert.rejects(data.execute(a, u.id, 'output', { mode: 'BLAZE' }), { code: 'SOURCE_RETIRED' });
  const exp = await f.sources.upload(a, upload(undefined, new Date(Date.now() + 60000).toISOString())); await data.refresh(a, exp.id); f.advance(61000);
  for (const mode of ['DIRECT_QUERY', 'BLAZE']) await assert.rejects(data.execute(a, exp.id, 'output', { mode }), { code: 'UPLOAD_EXPIRED' });
});
test('H3 asynchronous rotation, policy revision and owner removal prevent result publication', async t => {
  for (const change of ['rotate', 'policy', 'remove']) {
    const f = await sourceFixture(t), a = await f.login(); await f.sources.create(a, 'source', registration());
    let release, opened; const entered = new Promise(r => { opened = r; }), wait = new Promise(r => { release = r; });
    const data = new HostedData(f.sources, async (_read, _connection, _limits, sink) => { opened(); await wait; sink.start([{ name: 'amount', type: 'INTEGER' }]); sink.row([999]); }, f.budgets);
    const result = data.execute(a, 'source', 'output', { columns: ['amount'] }); await entered;
    if (change === 'rotate') await f.sources.rotate(a, 'source', { expectedVersion: 1, credentials: registration().credentials });
    else if (change === 'policy') await f.sources.bind(a, 'source', { expectedVersion: 1, policy: protectedPolicy });
    else await f.metadata.put(a, { kind: 'user', id: 'admin' }, { name: 'Removed capability', role: 'reader' }, 1);
    release(); await assert.rejects(result, { code: change === 'remove' ? 'AUTHORIZATION_REVISED' : 'METADATA_REVISED' });
  }
});
test('H3 protected prep, foreign imports, joins, append and unused branches fail before source I/O', async t => {
  const f = await sourceFixture(t), a = await f.login(); let io = 0;
  const data = new HostedData(f.sources, async () => { io++; }, f.budgets), prep = new HostedPrep(data);
  await f.sources.create(a, 'local', registration());
  await f.sources.create(a, 'protected', { ...registration(), policy: protectedPolicy });
  await f.sources.create(await f.login('two'), 'foreign', registration());
  for (const input of ['foreign', 'missing', 'protected']) {
    const code = input === 'protected' ? 'PREP_SECURITY_REJECTED' : 'RESOURCE_NOT_FOUND';
    await assert.rejects(prep.preview(a, 'draft', { pipeline: pipe(input) }), { code });
    await assert.rejects(prep.save(a, 'draft', { name: 'Draft', pipeline: pipe(input), expectedVersion: 0 }), { code });
    await assert.rejects(prep.import(a, { resource: { resourceType: 'dataset', dataSetId: 'imported', name: 'Imported', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: pipe(input) }, expectedVersion: 0 }), { code });
    for (const step of [
      { id: 'join', kind: 'join', config: { source: input, joinType: 'inner', keys: [{ left: 'region', right: 'region' }], prefix: 'r_' } },
      { id: 'append', kind: 'append', config: { source: input } },
    ]) await assert.rejects(prep.preview(a, 'draft', { pipeline: { ...pipe('local'), steps: [step] }, through: null }), { code });
  }
  await assert.rejects(prep.preview(a, 'draft', { pipeline: pipe({ dataset: 'foreign' }) }), { code: 'RESOURCE_NOT_FOUND' });
  assert.equal(io, 0);
});
test('H3 durable prepared output graph, restart admission and cached protected-source refusal', async t => {
  const f = await sourceFixture(t); let a = await f.login(), data = new HostedData(f.sources, undefined, f.budgets), prep = new HostedPrep(data);
  const u = await f.sources.upload(a, upload());
  const pipeline = { version: 1, input: u.id, steps: [
    { id: 'east', kind: 'filter', config: { filters: [{ columnName: 'region', value: 'east' }] } },
    { id: 'total', kind: 'aggregate', config: { groupBy: [], measures: [{ name: 'sum', column: 'amount', aggregation: 'SUM' }] } },
    { id: 'branch', from: 'east', kind: 'select', config: { columns: ['region'] } },
  ], output: 'total' };
  await prep.save(a, 'prepared', { name: 'Prepared', pipeline, expectedVersion: 0 });
  await prep.execute(a, 'prepared', 'refresh');
  assert.deepEqual((await prep.execute(a, 'prepared', 'rows')).rows, [{ sum: 40 }]);
  await f.restart(); a = await f.login(); data = new HostedData(f.sources, undefined, f.budgets); prep = new HostedPrep(data);
  assert.deepEqual((await prep.get(a, 'prepared')).resource.opensightPrep, pipeline);
  await assert.rejects(prep.execute(a, 'prepared', 'rows'), { code: 'BLAZE_NOT_READY' });
  await assert.rejects(prep.get(await f.login('one', 'other'), 'prepared'), { code: 'RESOURCE_NOT_FOUND' });
  await prep.execute(a, 'prepared', 'refresh');
  await f.sources.bind(a, u.id, { expectedVersion: 1, policy: protectedPolicy });
  for (const action of ['rows', 'query', 'refresh']) await assert.rejects(prep.execute(a, 'prepared', action, action === 'query' ? query : {}), { code: 'PREP_SECURITY_REJECTED' });
});
