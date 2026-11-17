import test from 'node:test';
import assert from 'node:assert/strict';
import { DuckDBInstance } from '@duckdb/node-api';
import { PGlite } from '@electric-sql/pglite';
import { compilePrep } from '../dist/index.js';
import { PrepError } from '@opensight/bundle-parser/prep';

const columns = [
  { name: 'id', type: 'INTEGER' }, { name: 'team', type: 'STRING' }, { name: 'amount', type: 'INTEGER' },
  { name: 'label', type: 'STRING' }, { name: 'active', type: 'BOOLEAN' }, { name: 'date', type: 'DATETIME' },
];
const source = dialect => ({ id: 'events', table: 'events', connectorId: dialect === 'postgres' ? 'postgresql' : 'file', columns, security: 'unrestricted' });
const base = { name: 'result', function: 'rowNumber', partitionBy: ['team'], orderBy: [{ column: 'id', direction: 'asc' }] };
const pipeline = config => ({ version: 1, input: 'events', steps: [{ id: 'w', kind: 'window', config }] });
const plan = (config, dialect = 'duckdb') => compilePrep(pipeline(config), [source(dialect)], { dialect });
async function engines(t) {
  const db = await DuckDBInstance.create(':memory:', { threads: '1' }), duck = await db.connect(), pg = new PGlite();
  t.after(async () => { duck.closeSync(); db.closeSync(); await pg.close(); });
  const setup = `CREATE TABLE events (id BIGINT, team VARCHAR, amount BIGINT, label VARCHAR, active BOOLEAN, date TIMESTAMP);
    INSERT INTO events VALUES (1,'A',10,'one',true,'2026-01-01'), (2,'A',10,'two',false,'2026-01-02'),
    (3,'A',30,'three',true,'2026-01-03'), (4,'A',NULL,NULL,NULL,NULL), (5,'B',5,'five',true,'2026-01-05'), (6,'B',8,'six',false,'2026-01-06');`;
  await duck.run(setup); await pg.exec(setup);
  return async (config, dialect) => {
    const p = plan(config, dialect);
    const rows = dialect === 'postgres' ? (await pg.query(p.sql, p.parameters)).rows : (await duck.runAndReadAll(p.sql, p.parameters)).getRowObjects();
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]))).sort((a, b) => a.id - b.id);
  };
}
const cases = [
  ['rowNumber', {}, [1,2,3,4,1,2], 'ROW_NUMBER()', 'INTEGER'],
  ['rank', {}, [1,2,3,4,1,2], 'RANK()', 'INTEGER'],
  ['denseRank', {}, [1,2,3,4,1,2], 'DENSE_RANK()', 'INTEGER'],
  ['runningTotal', { valueColumn: 'amount' }, [10,20,50,50,5,13], 'SUM(', 'DECIMAL'],
  ['runningAverage', { valueColumn: 'amount' }, [10,10,50/3,50/3,5,6.5], 'AVG(', 'DECIMAL'],
  ['lag', { valueColumn: 'label' }, [null,'one','two','three',null,'five'], 'LAG("label", 1)', 'STRING'],
  ['lead', { valueColumn: 'label' }, ['two','three',null,null,'six',null], 'LEAD("label", 1)', 'STRING'],
  ['movingAverage', { valueColumn: 'amount', frameBefore: 1, frameAfter: 1 }, [10,50/3,20,30,6.5,6.5], 'AVG(', 'DECIMAL'],
  ['movingSum', { valueColumn: 'amount', frameBefore: 1, frameAfter: 1 }, [20,50,40,30,13,13], 'SUM(', 'DECIMAL'],
  ['ntile', { buckets: 3 }, [1,1,2,3,1,2], 'NTILE(3)', 'INTEGER'],
];
test('every structured window function compiles and executes in both dialects', async t => {
  const run = await engines(t);
  for (const dialect of ['duckdb', 'postgres']) for (const [fn, extra, expected, sql, type] of cases) await t.test(`${dialect}: ${fn}`, async () => {
    const config = { ...base, function: fn, ...extra }, p = plan(config, dialect);
    assert.ok(p.sql.includes(sql), p.sql);
    assert.ok(p.sql.includes('PARTITION BY "team" ORDER BY "id" ASC NULLS LAST'));
    assert.deepEqual(p.columns, [...columns, { name: 'result', type }]);
    if (fn.startsWith('running')) assert.ok(p.sql.includes('ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW'));
    if (fn.startsWith('moving')) assert.ok(p.sql.includes('ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING'));
    if (type === 'DECIMAL') assert.ok(p.sql.includes(`CAST("amount" AS ${dialect === 'postgres' ? 'DOUBLE PRECISION' : 'DOUBLE'})`));
    assert.deepEqual((await run(config, dialect)).map(r => r.result), expected);
  });
});
test('partition, multiple order directions, ties, null ordering and offsets are explicit and portable', async t => {
  const run = await engines(t);
  for (const dialect of ['duckdb', 'postgres']) {
    for (const [fn, expected] of [['rank', [1,1,3,4,1,2]], ['denseRank', [1,1,2,3,1,2]]]) {
      assert.deepEqual((await run({ ...base, function: fn, orderBy: [{ column: 'amount', direction: 'asc' }] }, dialect)).map(r => r.result), expected);
    }
    const ordered = { ...base, orderBy: [{ column: 'amount', direction: 'desc' }, { column: 'id', direction: 'desc' }] };
    assert.deepEqual((await run(ordered, dialect)).map(r => r.result), [3,2,1,4,2,1]);
    assert.deepEqual((await run({ ...base, partitionBy: [] }, dialect)).map(r => r.result), [1,2,3,4,5,6]);
    for (const [fn, expected] of [['lag', [null,null,10,10,null,null]], ['lead', [30,null,null,null,null,null]]]) {
      assert.deepEqual((await run({ ...base, function: fn, valueColumn: 'amount', offset: 2 }, dialect)).map(r => r.result), expected);
    }
    for (const [valueColumn, type] of [['amount', 'INTEGER'], ['active', 'BOOLEAN'], ['date', 'DATETIME']]) {
      const c = { ...base, function: 'lag', valueColumn };
      assert.equal(plan(c, dialect).columns.at(-1).type, type);
      const rows = await run(c, dialect); assert.equal(rows[1].result, rows[0][valueColumn]);
    }
    const zero = { ...base, function: 'movingSum', valueColumn: 'amount' };
    assert.deepEqual((await run(zero, dialect)).map(r => r.result), [10,10,30,null,5,8]);
  }
});
test('advanced grammar executes the same window functions and safely quotes column names', async t => {
  const run = await engines(t);
  const expressions = [
    'ROW_NUMBER()', 'RANK()', 'DENSE_RANK()', 'SUM(amount)', 'AVG(amount)', 'LAG(label)', 'LEAD(label)', 'AVG(amount)', 'SUM(amount)', 'NTILE(3)',
  ];
  for (const dialect of ['duckdb', 'postgres']) for (const [i, [fn, , expected]] of cases.entries()) {
    const frame = fn.startsWith('running') ? ' ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW' : fn.startsWith('moving') ? ' ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING' : '';
    const expression = `${expressions[i]} OVER (PARTITION BY "team" ORDER BY "id" ASC${frame})`;
    assert.deepEqual((await run({ name: 'result', expression }, dialect)).map(r => r.result), expected);
  }
  for (const dialect of ['duckdb', 'postgres']) {
    for (const expression of ['lag(label, 2) over (partition by team order by id)', 'SUM(amount) OVER (ORDER BY id ROWS BETWEEN CURRENT ROW AND 0 FOLLOWING)']) {
      assert.equal((await run({ name: 'result', expression }, dialect)).length, 6);
    }
    const unusual = 'a"; --', special = { ...source(dialect), columns: [{ name: unusual, type: 'INTEGER' }] };
    const p = compilePrep(pipeline({ name: 'result', expression: 'ROW_NUMBER() OVER (ORDER BY "a""; --" DESC)' }), [special], { dialect });
    assert.ok(p.sql.includes('ORDER BY "a""; --" DESC NULLS LAST'));
  }
});
test('window compilation fails closed before SQL for invalid types, missing order, settings and expressions', () => {
  for (const dialect of ['duckdb', 'postgres']) {
    for (const [fn, extra] of cases) assert.throws(() => plan({ ...base, function: fn, ...extra, orderBy: [] }, dialect), e => e instanceof PrepError && e.code === 'PREP_WINDOW_ORDER_REQUIRED' && e.path.endsWith('.orderBy'));
    for (const config of [
      { ...base, name: 'ID' }, { ...base, partitionBy: ['missing'] }, { ...base, orderBy: [{ column: 'missing', direction: 'asc' }] },
      ...['runningTotal','runningAverage','movingSum','movingAverage'].flatMap(fn => ['label','active','date','missing'].map(valueColumn => ({ ...base, function: fn, valueColumn }))),
    ]) assert.throws(() => plan(config, dialect), e => e instanceof PrepError && e.code === 'PREP_SCHEMA_MISMATCH');
    for (const config of [{ ...base, frameBefore: 1 }, { ...base, function: 'ntile', buckets: 0 }, { ...base, function: 'lag', valueColumn: 'id', offset: -1 }, { ...base, function: 'movingSum', valueColumn: 'amount', frameAfter: -1 }]) {
      assert.throws(() => plan(config, dialect), e => e instanceof PrepError && e.code === 'INVALID_PREP_PIPELINE');
    }
    assert.throws(() => plan({ name: 'result', expression: 'ROW_NUMBER() OVER (PARTITION BY team)' }, dialect), e => e.code === 'PREP_WINDOW_ORDER_REQUIRED' && e.path.endsWith('.expression'));
    for (const expression of [
      'ROW_NUMBER()', 'id', 'abs(id)', 'ROW_NUMBER() OVER (ORDER BY id) + 1',
      'ROW_NUMBER() OVER (ORDER BY id); DROP TABLE events', 'ROW_NUMBER() OVER (ORDER BY id), RANK() OVER (ORDER BY id)',
      'SUM(abs(amount)) OVER (ORDER BY id)', 'SUM(amount + 1) OVER (ORDER BY id)', 'SUM(amount) OVER (ORDER BY id)',
      'COUNT(*) OVER (ORDER BY id)', 'MEDIAN(amount) OVER (ORDER BY id)', 'ROW_NUMBER(id) OVER (ORDER BY id)',
      'RANK() OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING)',
      'SUM(amount) OVER (ORDER BY id RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)',
      'SUM(amount) OVER (ORDER BY id ROWS BETWEEN -1 PRECEDING AND 1 FOLLOWING)',
      'LAG(amount, 0) OVER (ORDER BY id)', 'LEAD(amount, 1, 0) OVER (ORDER BY id)', 'NTILE(0) OVER (ORDER BY id)',
      'NTILE(2147483648) OVER (ORDER BY id)', 'ROW_NUMBER() OVER (ORDER BY id NULLS FIRST)',
      'ROW_NUMBER() OVER (ORDER BY id) -- comment', 'ROW_NUMBER() OVER (ORDER BY id COLLATE x)',
      'ROW_NUMBER() OVER (ORDER BY id, ID)', 'ROW_NUMBER() OVER (PARTITION BY team, team ORDER BY id)',
      'ROW_NUMBER() OVER (ORDER BY (SELECT id))', 'ROW_NUMBER() OVER (ORDER BY id) UNION SELECT 1',
    ]) assert.throws(() => plan({ name: 'result', expression }, dialect), e => e instanceof PrepError && ['UNSUPPORTED_PREP_STEP', 'INVALID_PREP_PIPELINE'].includes(e.code), expression);
    assert.throws(() => plan({ name: 'result', expression: 'SUM(label) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)' }, dialect), e => e.code === 'PREP_SCHEMA_MISMATCH');
  }
});
test('upstream grouping and earlier previews never supply or bypass window ordering', () => {
  const p = { version: 1, input: 'events', steps: [
    { id: 'a', kind: 'aggregate', config: { groupBy: ['team'], measures: [{ name: 'total', column: 'amount', aggregation: 'SUM' }] } },
    { id: 'w', kind: 'window', config: { ...base, partitionBy: [], orderBy: [] } },
  ] };
  for (const dialect of ['duckdb', 'postgres']) assert.throws(() => compilePrep(p, [source(dialect)], { dialect, through: 'a' }), e => e.code === 'PREP_WINDOW_ORDER_REQUIRED');
});
