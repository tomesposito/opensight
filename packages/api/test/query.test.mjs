import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createApiServer } from '@opensight/api';

const fixtures = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const query = () => ({ dimensions: [{ fieldId: 'region', columnName: 'region' }],
  measures: [{ fieldId: 'total', columnName: 'revenue', aggregation: 'SUM' }], filters: [] });
async function start(t, dataRoot = fixtures) {
  const server = await createApiServer({ dataRoot });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = once(server, 'close');
    server.close(); server.closeAllConnections(); await closed;
  });
  return (body, id = 'sales', options = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/datasets/${id}/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options,
  });
}

// Independent arithmetic over this simple, unquoted fixture CSV, including null cells.
const [header, ...lines] = (await readFile(join(fixtures, 'renderable-sales/sales.csv'), 'utf8')).trim().split('\n');
const csv = lines.map(line => Object.fromEntries(line.split(',').map((value, i) => [header.split(',')[i], value === '' ? null : value])));
function aggregates(rows, column) {
  const values = rows.map(row => row[column]).filter(value => value !== null).map(Number);
  return { SUM: values.reduce((sum, value) => sum + value, 0), AVG: values.reduce((sum, value) => sum + value, 0) / values.length,
    COUNT: values.length, MIN: Math.min(...values), MAX: Math.max(...values) };
}

test('query 200 computes real revenue and profit aggregations, including null semantics', async t => {
  const post = await start(t);
  const body = query();
  body.measures = ['revenue', 'profit'].flatMap(columnName => ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map(aggregation => ({
    fieldId: `${columnName}_${aggregation}`, columnName, aggregation,
  })));
  const response = await post(body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.deepEqual(result.columns, [{ name: 'region', type: 'string' }, ...body.measures.map(m => ({ name: m.fieldId, type: 'number' }))]);
  assert.deepEqual(result.rows, ['East', 'West'].map(region => ({ region, ...Object.fromEntries(['revenue', 'profit'].flatMap(column =>
    Object.entries(aggregates(csv.filter(row => row.region === region), column)).map(([aggregation, value]) => [`${column}_${aggregation}`, value]))) })));
  assert.deepEqual(result.rows.map(row => row.revenue_SUM), [500, 400]);
  assert.deepEqual(result.rows.map(row => row.profit_SUM), [65, 70]);
});

test('query computes MONTH and multiple dimensions after all requested equality filters', async t => {
  const post = await start(t, join(fixtures, 'renderable-sales'));
  const body = query();
  body.dimensions = [{ fieldId: 'date', columnName: 'order_date', granularity: 'MONTH' }, { fieldId: 'category', columnName: 'category' }];
  body.filters = [{ columnName: 'region', value: 'East' }, { columnName: 'category', value: 'Hardware' }];
  const response = await post(body);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { columns: [{ name: 'month', type: 'string' }, { name: 'category', type: 'string' }, { name: 'total', type: 'number' }], rows: [
    { month: '2025-01', category: 'Hardware', total: 100 }, { month: '2025-03', category: 'Hardware', total: 0 }, { month: '2025-04', category: 'Hardware', total: 100 },
  ] });
});

test('KPI totals use all sales rows, and filter values remain parameterized', async t => {
  const post = await start(t, join(fixtures, 'renderable-sales/analysis.json'));
  const body = { ...query(), dimensions: [] };
  const response = await post(body);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rows, [{ total: aggregates(csv, 'revenue').SUM }]);
  for (const value of ["East' OR 1=1 --", 'absent', '']) {
    const filtered = await post({ ...query(), filters: [{ columnName: 'region', value }] });
    assert.equal(filtered.status, 200);
    assert.deepEqual((await filtered.json()).rows, []);
  }
});

test('unknown and unresolved datasets return 404 with Message', async t => {
  const post = await start(t);
  for (const id of ['unknown', 'renderable-sales', '__proto__']) {
    const response = await post(query(), id);
    assert.equal(response.status, 404);
    assert.match((await response.json()).Message, /no resolved local sales CSV binding/);
  }
  const root = await mkdtemp(join(tmpdir(), 'opensight-query-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const unresolved = await start(t, root);
  assert.equal((await unresolved(query())).status, 404);
});

test('malformed JSON, UTF-8, content type and nested request shapes return 400', async t => {
  const post = await start(t);
  for (const body of [null, [], {}, { ...query(), extra: true }, { ...query(), localData: { csv: '/etc/passwd' } },
    { ...query(), filters: undefined }, { ...query(), measures: [] }, { ...query(), dimensions: [null] },
    { ...query(), measures: [{ fieldId: 'r', columnName: 'revenue', aggregation: 1 }] },
    { ...query(), filters: [{ columnName: 'region', value: 1 }] }, { ...query(), dimensions: [{ fieldId: '', columnName: 'region' }] },
    { ...query(), dimensions: [{ fieldId: 'r', columnName: 'region', granularity: null }] }]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof (await response.json()).Message, 'string');
  }
  for (const options of [{ body: '{' }, { body: '' }, { body: Buffer.from([0xff]) }, { headers: { 'Content-Type': 'text/plain' } }]) {
    assert.equal((await post(query(), 'sales', options)).status, 400);
  }
});

test('unsupported aggregation, granularity, fields and types preserve engine 422 diagnostics', async t => {
  const post = await start(t);
  for (const [body, code, message] of [
    [{ ...query(), measures: [{ fieldId: 'total', columnName: 'revenue', aggregation: 'MEDIAN' }] }, 'UNSUPPORTED_FEATURE', /SUM, AVG, COUNT, MIN or MAX/],
    [{ ...query(), dimensions: [{ fieldId: 'd', columnName: 'order_date', granularity: 'HOUR' }] }, 'UNSUPPORTED_FEATURE', /unsupported date granularity/],
    [{ ...query(), dimensions: [{ fieldId: 'id', columnName: 'order_id' }] }, 'TYPE_MISMATCH', /dimension type/],
    [{ ...query(), measures: [{ fieldId: 'x', columnName: 'missing', aggregation: 'SUM' }] }, 'UNRESOLVED_BINDING', /missing/],
  ]) {
    const response = await post(body);
    assert.equal(response.status, 422);
    const error = await response.json();
    assert.deepEqual(Object.keys(error).sort(), ['errorCode', 'message', 'path']);
    assert.equal(error.errorCode, code);
    assert.match(error.message, message);
    assert.match(error.path, /^\$\.analysis\.Definition\./);
  }
});

test('query route validates method, ID and unsupported URL selectors', async t => {
  const post = await start(t);
  const get = await post(undefined, 'sales', { method: 'GET' });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  for (const id of ['%ZZ', '%2e%2e%2fsales', 'x'.repeat(513)]) assert.equal((await post(query(), id)).status, 400);
  assert.equal((await post(query(), 'sales/query?limit=1#')).status, 400);
  assert.equal((await post(query(), '%73ales')).status, 200);
});

test('body cap returns JSON 413 for fixed-length and streamed bodies without poisoning later queries', async t => {
  const post = await start(t);
  for (const body of [' '.repeat(1024 * 1024 + 1), Readable.from(Array.from({ length: 17 }, () => ' '.repeat(64 * 1024)))]) {
    const response = await post(undefined, 'sales', { body, duplex: 'half' });
    assert.equal(response.status, 413);
    assert.match((await response.json()).Message, /1 MiB/);
  }
  assert.equal((await post(query())).status, 200);
});

test('builder calculated measures and dimensions execute after dependency binding and before static filters', async t => {
  const post = await start(t);
  const body = { dimensions: [{ fieldId: 'Area', columnName: 'Area' }],
    measures: [{ fieldId: 'Net', columnName: 'Net', aggregation: 'SUM' }],
    calculatedFields: [{ name: 'Net', expression: '{revenue} - {profit}' }, { name: 'Area', expression: '{region}' }],
    filters: [{ columnName: 'Area', values: ['East', 'West'] }],
  };
  const response = await post(body);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rows, [{ Area: 'East', Net: 340 }, { Area: 'West', Net: 280 }]);
  body.calculatedFields[0].expression = 'unsupportedFunction({revenue})';
  const unsupported = await post(body);
  assert.equal(unsupported.status, 422);
  assert.equal((await unsupported.json()).errorCode, 'UNSUPPORTED_FEATURE');
});

test('builder filters OR selected values, AND different fields, bind quotes and support select-none', async t => {
  const post = await start(t);
  const body = { ...query(), filters: [{ columnName: 'region', values: ['East', 'West', "East' OR TRUE --"] }, { columnName: 'category', values: ['Hardware'] }] };
  const response = await post(body);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rows, ['East', 'West'].map(region => ({ region, total: aggregates(csv.filter(row => row.region === region && row.category === 'Hardware'), 'revenue').SUM })));
  const none = await post({ ...query(), filters: [{ columnName: 'region', values: [] }] });
  assert.equal(none.status, 200); assert.deepEqual((await none.json()).rows, []);
  const quoted = await post({ ...query(), filters: [{ columnName: 'region', values: ["East' OR TRUE --", 'absent'] }] });
  assert.equal(quoted.status, 200); assert.deepEqual((await quoted.json()).rows, []);
});

test('builder transport rejects malformed calculation/filter lists and does not accept both filter shapes', async t => {
  const post = await start(t);
  for (const fields of [{ calculatedFields: null }, { calculatedFields: [{ name: 'Net', expression: '' }] },
    { calculatedFields: [{ name: 'Net', expression: '{revenue}', sql: 'select 1' }] },
    { filters: [{ columnName: 'region', values: ['East'], value: 'West' }] }, { filters: [{ columnName: 'region', values: [1] }] },
    { filters: [{ columnName: 'region', values: 'East' }] }, { filters: [{ columnName: 'region' }] }]) {
    assert.equal((await post({ ...query(), ...fields })).status, 400);
  }
});

const parameterQuery = () => ({ ...query(), filters: [{ columnName: 'region', parameterName: 'Region' }],
  parameterDeclarations: [{ name: 'Region', type: 'string', multiple: true }, { name: 'Scale', type: 'number', multiple: false }],
  parameterBindings: { Region: ['East'], Scale: [2] },
  calculatedFields: [{ name: 'Scaled', expression: '{revenue} * ${Scale}' }], measures: [{ fieldId: 'scaled', columnName: 'Scaled', aggregation: 'SUM' }],
});
test('parameter binding changes requery the live API with typed filters and expressions', async t => {
  const post = await start(t), body = parameterQuery();
  for (const [selection, expected] of [[['East'], [{ region: 'East', scaled: 1000 }]], [['West'], [{ region: 'West', scaled: 800 }]], [[], []]]) {
    body.parameterBindings.Region = selection;
    const response = await post(body); assert.equal(response.status, 200); assert.deepEqual((await response.json()).rows, expected);
  }
  body.parameterBindings.Region = ["East' OR TRUE --"];
  assert.deepEqual((await (await post(body)).json()).rows, []);
});
test('strict parameter transport rejects invalid declarations, bindings and mixed filter shapes with clear paths', async t => {
  const post = await start(t);
  for (const mutate of [
    b => { b.parameterBindings.Region = [1]; }, b => { b.parameterBindings.Scale = ['2']; }, b => { b.parameterBindings.Scale = [null]; },
    b => { b.parameterDeclarations[1].integer = true; b.parameterBindings.Scale = [1.2]; },
    b => { b.parameterDeclarations[1].type = 'datetime'; b.parameterBindings.Scale = ['2025-02-30']; },
    b => { b.parameterDeclarations[1].type = 'datetime'; b.parameterDeclarations[1].multiple = true; b.parameterBindings.Scale = ['2025-01-01']; },
    b => { b.parameterBindings.Scale = [1, 2]; }, b => { b.parameterBindings.extra = ['x']; }, b => { delete b.parameterBindings.Scale; },
    b => { b.parameterDeclarations[1].sql = 'select 1'; }, b => { b.parameterDeclarations.push(b.parameterDeclarations[0]); },
    b => { b.filters[0].parameterName = 'Unknown'; }, b => { b.filters[0].values = ['East']; }, b => { b.filters[0].operator = 'DROP'; },
  ]) {
    const body = parameterQuery(); mutate(body); const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body)); assert.match((await response.json()).Message, /parameter|filters/);
  }
  const badColumn = parameterQuery(); badColumn.filters[0].columnName = 'revenue';
  const response = await post(badColumn); assert.equal(response.status, 422); assert.match((await response.json()).message, /does not match/);
});

test('calculated catalog reaches the API SQL and shared table stages', async t => {
  const post = await start(t);
  const response = await post({ dimensions: [{ fieldId: 'region', columnName: 'region' }], measures: [{ fieldId: 'share', columnName: 'Share', aggregation: 'SUM' }], filters: [], calculatedFields: [
    { name: 'Net', expression: 'round(coalesce({revenue}, 0), 2)' },
    { name: 'Share', expression: 'percentOfTotal(sum({Net}))' },
  ] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rows, [{ region: 'East', share: 500/900 }, { region: 'West', share: 400/900 }]);
  const invalid = await post({ dimensions: [], measures: [{ fieldId: 'bad', columnName: 'Bad', aggregation: 'SUM' }], filters: [], calculatedFields: [{ name: 'Bad', expression: 'round({revenue}, 1, 2)' }] });
  assert.equal(invalid.status, 422); assert.match((await invalid.json()).message, /round.*Expected round/);
});
