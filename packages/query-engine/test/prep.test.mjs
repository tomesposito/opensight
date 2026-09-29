import test from 'node:test';
import assert from 'node:assert/strict';
import { DuckDBInstance } from '@duckdb/node-api';
import { PGlite } from '@electric-sql/pglite';
import { compilePrep } from '../dist/index.js';
export const columns = [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }, { name: 'category', type: 'STRING' }];
export const source = { id: 'sales', connectorId: 'file', table: 'sales', columns, security: 'unrestricted' };
export const pipeline = steps => ({ version: 1, input: 'sales', steps: steps.map((s, i) => ({ id: `s${i}`, ...s })) });
export async function engines(t) {
  const db = await DuckDBInstance.create(':memory:', { threads: '1' }), duck = await db.connect(), pg = new PGlite();
  t.after(async () => { duck.closeSync(); db.closeSync(); await pg.close(); });
  const setup = "CREATE TABLE sales (region VARCHAR, amount DOUBLE PRECISION, category VARCHAR); INSERT INTO sales VALUES ('East', 2.9, 'A'), ('West', 3.1, 'B'), ('East', 4, 'B'), (NULL, NULL, 'A');";
  await duck.run(setup); await pg.exec(setup);
  return async (steps, options = {}, extra = []) => {
    const results = [];
    for (const dialect of ['duckdb', 'postgres']) {
      const sources = [source, ...extra].map(s => ({ ...s, connectorId: dialect === 'postgres' ? 'postgresql' : 'file' }));
      const plan = compilePrep(pipeline(steps), sources, { dialect, ...options });
      const rows = dialect === 'duckdb' ? (await duck.runAndReadAll(plan.sql, plan.parameters)).getRowObjects() : (await pg.query(plan.sql, plan.parameters)).rows;
      const normalize = rows => rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, typeof v === 'bigint' ? Number(v) : v]))).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      results.push(normalize(rows));
    }
    assert.deepEqual(results[0], results[1]); return results[0];
  };
}
test('prep column transforms execute identically in DuckDB and Postgres', async t => {
  const run = await engines(t);
  assert.deepEqual(await run([{ kind: 'changeType', config: { column: 'amount', type: 'INTEGER' } }, { kind: 'rename', config: { column: 'amount', name: 'revenue' } }, { kind: 'select', config: { columns: ['revenue'] } }]), [{ revenue: 2 }, { revenue: 3 }, { revenue: 4 }, { revenue: null }]);
  assert.equal((await run([{ kind: 'rename', config: { column: 'amount', name: 'revenue' } }], { through: null })).some(r => 'amount' in r), true);
});
test('prep refuses unknown columns, case collisions, invalid previews and unresolved security before SQL', () => {
  for (const step of [{ kind: 'select', config: { columns: ['missing'] } }, { kind: 'rename', config: { column: 'amount', name: 'REGION' } }]) assert.throws(() => compilePrep(pipeline([step]), [source]), e => e.code === 'PREP_SCHEMA_MISMATCH');
  assert.throws(() => compilePrep(pipeline([]), [{ ...source, security: 'protected' }]), e => e.code === 'PREP_SECURITY_REJECTED');
  assert.throws(() => compilePrep(pipeline([]), []), e => e.code === 'PREP_SOURCE_NOT_FOUND');
  assert.throws(() => compilePrep(pipeline([]), [source], { limit: 501 }), e => e.code === 'PREP_LIMIT_EXCEEDED');
});
test('prep filters reuse Phase 2b membership, ranges, empty-list and null semantics', async t => {
  const run = await engines(t);
  assert.deepEqual(await run([{ kind: 'filter', config: { filters: [{ columnName: 'region', values: ['East'] }, { columnName: 'amount', operator: 'GREATER_THAN_OR_EQUAL_TO', value: 3 }] } }]), [{ region: 'East', amount: 4, category: 'B' }]);
  assert.deepEqual(await run([{ kind: 'filter', config: { filters: [{ columnName: 'region', values: [] }] } }]), []);
  assert.deepEqual(await run([{ kind: 'filter', config: { filters: [{ columnName: 'region', value: "East' OR TRUE --" }] } }]), []);
  assert.throws(() => compilePrep(pipeline([{ kind: 'filter', config: { filters: [{ columnName: 'amount', value: '3' }] } }]), [source]), e => e.code === 'PREP_SCHEMA_MISMATCH');
});
test('prep calculated columns reuse the typed function library and feed subsequent steps', async t => {
  const run = await engines(t);
  assert.deepEqual(await run([{ kind: 'calculate', config: { name: 'upper_region', expression: 'upper({region})' } }, { kind: 'calculate', config: { name: 'label', expression: "concat({upper_region}, ' zone')" } }, { kind: 'filter', config: { filters: [{ columnName: 'label', value: 'EAST zone' }] } }, { kind: 'select', config: { columns: ['label'] } }]), [{ label: 'EAST zone' }, { label: 'EAST zone' }]);
  assert.equal((await run([{ kind: 'calculate', config: { name: 'date', expression: "parseDate('2024-02-29')" } }]))[0].date, '2024-02-29T00:00:00.000Z');
  for (const expression of ['sum({amount})', 'sumOver({amount}, [], PRE_AGG)', 'unknown({amount})', '{missing} + 1']) assert.throws(() => compilePrep(pipeline([{ kind: 'calculate', config: { name: 'result', expression } }]), [source]));
});
test('prep aggregate and explicit pivot/unpivot have shared null and grouping semantics', async t => {
  const run = await engines(t);
  const grouped = await run([{ kind: 'aggregate', config: { groupBy: ['region'], measures: [{ column: 'amount', name: 'total', aggregation: 'SUM' }, { column: 'amount', name: 'count', aggregation: 'COUNT' }] } }]);
  assert.ok(grouped.some(r => r.region === 'East' && r.total === 6.9 && r.count === 2));
  const pivot = { kind: 'pivot', config: { groupBy: ['region'], column: 'category', value: 'amount', aggregation: 'SUM', values: [{ value: 'A', name: 'a' }, { value: 'B', name: 'b' }] } };
  const rows = await run([pivot]); assert.ok(rows.some(r => r.region === 'East' && r.a === 2.9 && r.b === 4));
  const unpivoted = await run([pivot, { kind: 'unpivot', config: { columns: ['a', 'b'], nameColumn: 'kind', valueColumn: 'value' } }]);
  assert.equal(unpivoted.length, 6); assert.equal(unpivoted.filter(r => r.value === null).length, 3);
  for (const aggregation of ['COUNT','MIN','MAX','AVG']) await run([{ kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'amount', name: 'result', aggregation }] } }]);
});
test('prep joins preserve multiplicity and SQL null semantics; append preserves duplicate rows', async t => {
  const run = await engines(t), right = { ...source, id: 'right' };
  const expected = { inner: 5, left: 6, right: 6, full: 7 };
  const joinStep = joinType => ({ kind: 'join', config: { source: 'right', joinType, keys: [{ left: 'region', right: 'region' }], columns: [{ column: 'amount', name: 'right_amount' }, { column: 'category', name: 'right_category' }] } });
  for (const joinType of Object.keys(expected)) {
    const rows = await run([joinStep(joinType)], {}, [right]);
    assert.equal(rows.length, expected[joinType]);
    if (joinType === 'right') assert.ok(rows.some(r => r.region === null && r.right_category === 'A'), 'right join keeps unmatched right rows with null left columns');
  }
  assert.throws(() => compilePrep(pipeline([{ kind: 'join', config: { source: 'right', joinType: 'cross', keys: [{ left: 'region', right: 'region' }], columns: [] } }]), [source, right]), e => e.code === 'INVALID_PREP_PIPELINE');
  assert.equal((await run([{ kind: 'append', config: { source: 'right' } }], {}, [right])).length, 8);
  for (const kind of ['join', 'append']) {
    const config = kind === 'join' ? { source: 'right', joinType: 'inner', keys: [{ left: 'region', right: 'region' }], columns: [{ column: 'amount', name: 'other' }] } : { source: 'right' };
    assert.throws(() => compilePrep(pipeline([{ kind, config }]), [source, { ...right, security: 'protected' }]), e => e.code === 'PREP_SECURITY_REJECTED');
  }
});
test('prep validates all stages even for an earlier preview; no unsupported steps disappear', () => {
  assert.throws(() => compilePrep(pipeline([{ kind: 'select', config: { columns: ['region'] } }, { kind: 'select', config: { columns: ['amount'] } }]), [source], { through: 's0' }), e => e.code === 'PREP_SCHEMA_MISMATCH');
  assert.throws(() => compilePrep(pipeline([{ kind: 'append', config: { source: 'right' } }]), [source, { ...source, id: 'right', columns: columns.slice(1) }]), e => e.code === 'PREP_SCHEMA_MISMATCH');
});
test('private upload execution bounds the output and reports unknown totals honestly', async t => {
  const { UploadStaging } = await import('../dist/index.js');
  const staging = await UploadStaging.create(); t.after(() => staging.close());
  const upload = await staging.ingest({ config: { format: 'csv' }, data: new TextEncoder().encode('label,n\na,1\nb,2\nc,3\n') });
  const p = { version: 1, input: upload.id, steps: [] };
  const result = await staging.previewPrep(p, { limit: 2 });
  assert.equal(result.rows.length, 2); assert.equal(result.truncated, true); assert.equal(result.totalRows, null); assert.equal(result.rowCountLowerBound, 3);
  assert.equal((await staging.previewPrep(p, { limit: 3 })).totalRows, 3);
  const sources = staging.prepSources(); sources[0].columns[0].name = 'mutated';
  assert.equal(staging.prepSources()[0].columns[0].name, 'label');
  const counted = await staging.previewPrep({ ...p, steps: [{ id: 'a', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'n', name: 'total', aggregation: 'SUM' }] } }] }, { limit: 1 });
  assert.deepEqual(counted.rows, [{ total: 6 }]); assert.equal(counted.totalRows, 1);
  await assert.rejects(staging.previewPrep({ ...p, input: 'another-owner' }), e => e.code === 'PREP_SOURCE_NOT_FOUND');
});
test('string conversions share function-library parsing, invalid values become null', async t => {
  const run = await engines(t);
  for (const type of ['INTEGER','DECIMAL','DATETIME','BOOLEAN']) {
    const result = await run([{ kind: 'changeType', config: { column: 'category', type } }]);
    assert.ok(result.every(r => r.category === null));
  }
});
test('numeric-to-string preparation normalizes integer-valued decimals in both dialects', async t => {
  const run = await engines(t);
  const rows = await run([{ kind: 'changeType', config: { column: 'amount', type: 'STRING' } }, { kind: 'select', config: { columns: ['amount'] } }]);
  assert.deepEqual(rows, [{ amount: '2.9' }, { amount: '3.1' }, { amount: '4' }, { amount: null }]);
});

const joinConfig = (source = 'right', extra = {}) => ({ source, joinType: 'left', keys: [{ left: 'region', right: 'region' }], prefix: 'r_', ...extra });
test('joins reject mismatched and missing keys, aliases, prefix collisions and schema bounds', () => {
  const right = { ...source, id: 'right' }, p = config => pipeline([{ kind: 'join', config }]);
  for (const config of [
    joinConfig('right', { keys: [{ left: 'region', right: 'amount' }] }),
    joinConfig('right', { keys: [{ left: 'missing', right: 'region' }] }),
    joinConfig('right', { keys: [{ left: 'region', right: 'missing' }] }),
    { ...joinConfig(), prefix: undefined, columns: [{ column: 'missing', name: 'alias' }] },
    { source: 'right', joinType: 'left', keys: [{ left: 'region', right: 'region' }], columns: [{ column: 'amount', name: 'REGION' }] },
    { source: 'right', joinType: 'left', keys: [{ left: 'region', right: 'region' }], columns: [{ column: 'amount', name: 'r' }, { column: 'category', name: 'R' }] },
    joinConfig('right', { prefix: 'x'.repeat(128) }),
  ]) {
    if (config.prefix === undefined) delete config.prefix;
    assert.throws(() => compilePrep(p(config), [source, right]), e => e.code === 'PREP_SCHEMA_MISMATCH');
  }
  assert.throws(() => compilePrep(p(joinConfig()), [source, { ...right, columns: [{ name: 'region', type: 'INTEGER' }] }]), e => e.code === 'PREP_SCHEMA_MISMATCH' && /region \(STRING\).*region \(INTEGER\)/.test(e.message));
  const many = Array.from({ length: 254 }, (_, i) => ({ name: `n${i}`, type: 'STRING' }));
  assert.throws(() => compilePrep(p(joinConfig('right', { keys: [{ left: 'region', right: 'n0' }] })), [source, { ...right, columns: many }]), e => e.code === 'PREP_SCHEMA_MISMATCH');
  const renamed = pipeline([{ kind: 'rename', config: { column: 'amount', name: 'r_region' } }, { kind: 'join', config: joinConfig() }]);
  assert.throws(() => compilePrep(renamed, [source, right]), e => e.code === 'PREP_SCHEMA_MISMATCH');
});
test('composite joins, prefix outputs, chained joins and reuse of joined results agree across engines', async t => {
  const run = await engines(t), right = { ...source, id: 'right' };
  for (const joinType of ['inner', 'left', 'right', 'full']) {
    const rows = await run([{ kind: 'join', config: joinConfig('right', { joinType, keys: [{ left: 'region', right: 'region' }, { left: 'category', right: 'category' }] }) }], {}, [right]);
    assert.equal(rows.length, { inner: 3, left: 4, right: 4, full: 5 }[joinType]);
    assert.ok(rows.some(r => r.region === 'East' && r.r_region === 'East' && r.r_amount === r.amount));
  }
  const steps = [
    { kind: 'join', config: joinConfig() },
    { kind: 'join', config: joinConfig({ step: 's0' }, { keys: [{ left: 'r_category', right: 'r_category' }], prefix: 'again_' }) },
    { kind: 'filter', config: { filters: [{ columnName: 'again_r_category', value: 'B' }] } },
    { kind: 'calculate', config: { name: 'combined', expression: '{r_amount} + {again_r_amount}' } },
    { kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'combined', name: 'count', aggregation: 'COUNT' }] } },
  ];
  assert.deepEqual(await run(steps, {}, [right]), [{ count: 9 }]);
  assert.equal((await run(steps, { through: 's0' }, [right])).length, 6);
});
test('prepared inputs and nested joins expand without sampling, preserve parameters and reuse relations', async t => {
  const run = await engines(t);
  const datasets = [
    { id: 'east', pipeline: pipeline([{ kind: 'filter', config: { filters: [{ columnName: 'region', value: 'East' }] } }]) },
    { id: 'joined', pipeline: pipeline([{ kind: 'join', config: joinConfig({ dataset: 'east' }) }]) },
  ];
  const steps = [{ kind: 'join', config: joinConfig({ dataset: 'joined' }) }, { kind: 'filter', config: { filters: [{ columnName: 'r_r_category', value: 'A' }] } }];
  const rows = await run(steps, { datasets }); assert.equal(rows.length, 4);
  assert.equal((await run(steps, { datasets, through: null })).length, 4);
  assert.equal((await run(steps, { datasets, through: 's0' })).length, 10);
  // A prepared primary input remains a relation, without a preview limit inside it.
  const { UploadStaging } = await import('../dist/index.js'); const staging = await UploadStaging.create(); t.after(() => staging.close());
  const uploaded = await staging.ingest({ config: { format: 'csv' }, data: new TextEncoder().encode('n\n' + Array.from({ length: 150 }, () => '1').join('\n')) });
  const prepared = [{ id: 'all', pipeline: { version: 1, input: uploaded.id, steps: [] } }];
  const p = { version: 1, input: { dataset: 'all' }, steps: [{ id: 'sum', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'n', name: 'total', aggregation: 'SUM' }] } }] };
  assert.deepEqual((await staging.previewPrep(p, { datasets: prepared, limit: 1 })).rows, [{ total: 150 }]);
});
test('prepared graphs fail closed on cycles, missing/protected inputs and excessive expansion', () => {
  const p = { version: 1, input: { dataset: 'a' }, steps: [] };
  assert.throws(() => compilePrep(p, [source]), e => e.code === 'PREP_SOURCE_NOT_FOUND');
  const cycle = [{ id: 'a', pipeline: { ...p, input: { dataset: 'b' } } }, { id: 'b', pipeline: p }];
  assert.throws(() => compilePrep(p, [source], { datasets: cycle }), e => e.code === 'INVALID_PREP_PIPELINE');
  assert.throws(() => compilePrep(p, [source], { datasets: [{ id: 'a', pipeline: pipeline([]) }], datasetId: 'a' }), e => e.code === 'INVALID_PREP_PIPELINE');
  assert.throws(() => compilePrep(p, [{ ...source, security: 'protected' }], { datasets: [{ id: 'a', pipeline: pipeline([]) }] }), e => e.code === 'PREP_SECURITY_REJECTED');
  const deep = Array.from({ length: 17 }, (_, i) => ({ id: `d${i}`, pipeline: { version: 1, input: i === 16 ? 'sales' : { dataset: `d${i + 1}` }, steps: [] } }));
  assert.throws(() => compilePrep({ ...p, input: { dataset: 'd0' } }, [source], { datasets: deep }), e => e.code === 'PREP_LIMIT_EXCEEDED');
  const wide = Array.from({ length: 11 }, (_, i) => ({ id: `d${i}`, pipeline: pipeline(Array.from({ length: 50 }, () => ({ kind: 'select', config: { columns: ['region'] } }))) }));
  const joins = pipeline(wide.map((d, i) => ({ kind: 'join', config: joinConfig({ dataset: d.id }, { prefix: `r${i}_` }) })));
  assert.throws(() => compilePrep(joins, [source], { datasets: wide }), e => e.code === 'PREP_LIMIT_EXCEEDED');
});

test('join keys enforce the complete type matrix; all five key types execute identically', async t => {
  const db = await DuckDBInstance.create(':memory:', { threads: '1' }), duck = await db.connect(), pg = new PGlite();
  t.after(async () => { duck.closeSync(); db.closeSync(); await pg.close(); });
  const cols = [{ name: 'i', type: 'INTEGER' }, { name: 'd', type: 'DECIMAL' }, { name: 's', type: 'STRING' }, { name: 't', type: 'DATETIME' }, { name: 'b', type: 'BOOLEAN' }];
  const setup = "CREATE TABLE typed (i BIGINT, d DOUBLE PRECISION, s VARCHAR, t TIMESTAMP, b BOOLEAN); INSERT INTO typed VALUES (1, 1.5, 'match', '2026-09-29 12:00:00', TRUE), (NULL, NULL, NULL, NULL, NULL);";
  await duck.run(setup); await pg.exec(setup);
  const src = { ...source, id: 'typed', table: 'typed', columns: cols };
  for (const left of cols) for (const right of cols) {
    const p = { version: 1, input: 'typed', steps: [{ id: 'join', kind: 'join', config: { source: { dataset: 'typed-copy' }, joinType: 'full', keys: [{ left: left.name, right: right.name }], prefix: 'r_' } }] };
    const datasets = [{ id: 'typed-copy', pipeline: { version: 1, input: 'typed', steps: [{ id: 'keep', kind: 'select', config: { columns: cols.map(c => c.name) } }] } }];
    const results = [];
    for (const dialect of ['duckdb', 'postgres']) {
      const sources = [{ ...src, connectorId: dialect === 'postgres' ? 'postgresql' : 'file' }];
      if (left.type !== right.type) { assert.throws(() => compilePrep(p, sources, { dialect, datasets }), e => e.code === 'PREP_SCHEMA_MISMATCH'); continue; }
      const plan = compilePrep(p, sources, { dialect, datasets });
      const rows = dialect === 'duckdb' ? (await duck.runAndReadAll(plan.sql, plan.parameters)).getRowObjects() : (await pg.query(plan.sql, plan.parameters)).rows;
      results.push(rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key === 'i' || key === 'r_i' ? value === null ? null : Number(value) : value]))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    }
    if (results.length) { assert.deepEqual(results[0], results[1]); assert.equal(results[0].length, 3); assert.equal(results[0].filter(r => r.i === null && r.r_i === null).length, 2); }
  }
});
test('asymmetric and empty prepared sides preserve exact outer-join rows in both engines', async t => {
  const run = await engines(t), datasets = [
    { id: 'left-only', pipeline: pipeline([{ kind: 'filter', config: { filters: [{ columnName: 'region', value: 'East' }] } }]) },
    { id: 'right-only', pipeline: pipeline([{ kind: 'filter', config: { filters: [{ columnName: 'region', value: 'West' }] } }]) },
    { id: 'empty', pipeline: pipeline([{ kind: 'filter', config: { filters: [{ columnName: 'region', values: [] }] } }]) },
  ];
  for (const joinType of ['inner', 'left', 'right', 'full']) {
    const steps = [{ kind: 'filter', config: { filters: [{ columnName: 'region', value: 'East' }] } }, { kind: 'join', config: joinConfig({ dataset: 'right-only' }, { joinType }) }];
    const rows = await run(steps, { datasets });
    assert.equal(rows.length, { inner: 0, left: 2, right: 1, full: 3 }[joinType]);
    if (joinType === 'right' || joinType === 'full') assert.ok(rows.some(r => r.region === null && r.r_region === 'West' && r.r_amount === 3.1));
    const emptyRight = await run([{ kind: 'join', config: joinConfig({ dataset: 'empty' }, { joinType }) }], { datasets });
    assert.equal(emptyRight.length, { inner: 0, left: 4, right: 0, full: 4 }[joinType]);
    const emptyLeft = await run([{ kind: 'filter', config: { filters: [{ columnName: 'region', values: [] }] } }, { kind: 'join', config: joinConfig('sales', { joinType }) }], { datasets });
    assert.equal(emptyLeft.length, { inner: 0, left: 0, right: 4, full: 4 }[joinType]);
  }
});
test('memoized prepared dependencies retain depth limits and compile just once', () => {
  const chain = Array.from({ length: 16 }, (_, i) => ({ id: `d${i}`, pipeline: { version: 1, input: i === 15 ? 'sales' : { dataset: `d${i + 1}` }, steps: [{ id: 'keep', kind: 'select', config: { columns: ['region'] } }] } }));
  const p = pipeline([{ kind: 'join', config: joinConfig({ dataset: 'd0' }) }, { kind: 'join', config: joinConfig({ dataset: 'd0' }, { prefix: 'again_' }) }]);
  const plan = compilePrep(p, [source], { datasets: chain });
  assert.equal((plan.sql.match(/ AS \(SELECT/g) ?? []).length, 18);
  const tooDeep = [...chain, { id: 'extra', pipeline: { version: 1, input: { dataset: 'd0' }, steps: [] } }];
  p.steps[1].config.source = { dataset: 'extra' };
  assert.throws(() => compilePrep(p, [source], { datasets: tooDeep }), e => e.code === 'PREP_LIMIT_EXCEEDED');
});
