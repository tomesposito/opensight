import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { InputTableRoutes } from '../dist/input-table-routes.js';
import { PrepRoutes } from '../dist/prep-routes.js';
import { ConnectorRoutes } from '../dist/connector-routes.js';
const identity = { namespaceId: 'one', userId: 'author' };
const columns = [{ name: 'id', type: 'INTEGER' }];
const source = id => ({ id, table: id.replaceAll('-', '_'), columns, connectorId: 'file', security: 'unrestricted' });
const pipeline = { version: 1, input: 'input-table-left', steps: [{ id: 'join', kind: 'join', config: { source: 'input-table-right', joinType: 'inner', prefix: 'r_', keys: [{ left: 'id', right: 'id' }] } }] };
async function request(prep, p = pipeline) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ pipeline: p, through: 'join' }))]), { method: 'POST', headers: { 'content-type': 'application/json' } });
  let status, body; const res = { writeHead(s) { status = s; }, end(raw) { body = JSON.parse(raw); } };
  await prep.route(req, res, '/api/datasets/draft/prep/join-diagnostics', '', identity);
  return { status, body };
}
test('Issue #288 governed input hook is bounded before staging and inherits truncation through filters', async () => {
  const prep = await PrepRoutes.create(new ConnectorRoutes()), calls = [], consumed = [];
  const sources = ['input-table-left', 'input-table-right'].map(source);
  prep.inputTableSources = () => sources;
  prep.inputTableTables = () => { throw Error('Ordinary full-table hook forbidden'); };
  prep.inputTableSamples = (who, ids, limit) => {
    assert.deepEqual(who, identity); assert.equal(limit, 10001); calls.push(ids);
    return ids.map(id => ({ source: sources.find(s => s.id === id), rowCount: id.endsWith('left') ? limit : 3, value(r) {
      assert.ok(r < limit); consumed.push(r); return id.endsWith('left') ? (r < 2 ? 1 : 2) : 1;
    } }));
  };
  const result = await request(prep); assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.matchedRows, 6); assert.equal(result.body.fanOut, true); assert.equal(result.body.leftRowsSampled, 10000); assert.equal(result.body.leftTruncated, true);
  assert.equal(result.body.rightTruncated, false); assert.equal(Math.max(...consumed), 10000);
  assert.deepEqual(calls, [['input-table-left', 'input-table-right']]);
  const filtered = { ...pipeline, steps: [{ id: 'filter', kind: 'filter', config: { filters: [{ columnName: 'id', values: [9] }] } }, ...pipeline.steps] };
  const zero = await request(prep, filtered); assert.equal(zero.body.leftRowsSampled, 0); assert.equal(zero.body.leftTruncated, true); assert.equal(zero.body.matchedRows, 0);
});
test('Issue #288 old governed hooks remain usable for preview but diagnostics fail closed without a bounded contract', async () => {
  const prep = await PrepRoutes.create(new ConnectorRoutes()); let full = 0;
  prep.inputTableSources = () => ['input-table-left', 'input-table-right'].map(source);
  prep.inputTableTables = () => { full++; return []; };
  assert.equal((await request(prep)).body.errorCode, 'UNSUPPORTED_PREP_STEP'); assert.equal(full, 0);
  prep.inputTableSamples = (_who, ids) => ids.map(id => ({ source: source(id), rowCount: 10002, value() { throw Error('Must reject before consuming'); } }));
  assert.equal((await request(prep)).body.errorCode, 'PREP_EXECUTION_FAILED');
  prep.inputTableSamples = () => [];
  assert.equal((await request(prep)).body.errorCode, 'PREP_SOURCE_NOT_FOUND');
});
test('Issue #288 governed source discovery and sampling project before cloning, including namespace denial', () => {
  let consumed = 0;
  const rows = new Proxy(Array.from({ length: 10000 }, (_, i) => ({ id: `row-${i}`, values: { id: i } })), {
    get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) { assert.ok(Number(key) < 3, 'Never visit unsampled rows'); consumed++; } return Reflect.get(target, key, receiver); },
  });
  const table = { id: 'left', namespaceId: 'one', ownerId: 'author', name: 'Test', columns: [{ name: 'id', type: 'number', required: false }], rows, editors: [] };
  const store = { read() { throw Error('Full store clone forbidden'); }, store: { project: fn => structuredClone(fn({ tables: [table] })) } };
  const routes = new InputTableRoutes(store);
  assert.equal(routes.prepSourcesFor(identity).length, 1); assert.equal(consumed, 0);
  const sample = routes.prepSamplesFor(identity, ['input-table-left'], 3); assert.equal(sample[0].rowCount, 3); assert.equal(sample[0].value(2, 0), 2); assert.equal(consumed, 3);
  assert.deepEqual(routes.prepSamplesFor({ ...identity, namespaceId: 'foreign' }, ['input-table-left'], 3), []);
  assert.throws(() => routes.prepSamplesFor(identity, ['input-table-left'], 10002), { code: 'PREP_LIMIT_EXCEEDED' });
});
