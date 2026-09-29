import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compilePrep } from '../dist/index.js';
const source = { id: 'sales', table: 'sales', connectorId: 'file', security: 'unrestricted', columns: [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }] };
const pipeline = { version: 1, input: 'sales', output: 'detail', steps: [
  { id: 'clean', kind: 'select', config: { columns: ['region', 'amount'] } },
  { id: 'detail', kind: 'filter', config: { filters: [{ columnName: 'region', value: 'East' }] } },
  { id: 'total', from: 'clean', kind: 'aggregate', config: { groupBy: ['region'], measures: [{ column: 'amount', name: 'total', aggregation: 'SUM' }] } },
  { id: 'summary', from: 'total', kind: 'select', config: { columns: ['region', 'total'] } },
] };
test('linear plans remain byte-identical to the pre-branching compiler', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/prep-linear-plans.json', import.meta.url), 'utf8'));
  for (const fixture of fixtures) assert.equal(JSON.stringify(compilePrep(fixture.pipeline, fixture.sources, fixture.options)), fixture.serializedPlan);
});
test('branch chains reuse upstream CTEs, retain all stage schemas and select output or preview', () => {
  const plan = compilePrep(pipeline, [source]);
  assert.equal(plan.through, 'detail'); assert.deepEqual(plan.columns, source.columns);
  assert.equal(plan.stages.length, 4); assert.deepEqual(plan.stages[3].columns.map(c => c.name), ['region', 'total']);
  const all = compilePrep(pipeline, [source], { through: 'summary' });
  assert.equal((all.sql.match(/ AS \(SELECT/g) ?? []).length, 4);
  assert.match(all.sql, /FROM "__prep_0" GROUP BY/);
  assert.match(all.sql, /"__prep_3" AS \(SELECT "region", "total" FROM "__prep_2"\)/);
  assert.equal(compilePrep(pipeline, [source], { through: null }).through, null);
  const implicit = structuredClone(pipeline); delete implicit.output;
  assert.equal(compilePrep(implicit, [source]).through, 'summary');
  const invalid = structuredClone(pipeline); invalid.steps[3].config.columns = ['missing'];
  assert.throws(() => compilePrep(invalid, [source]), e => e.code === 'PREP_SCHEMA_MISMATCH');
});
test('prepared dataset references use their selected output instead of their last branch', () => {
  const plan = compilePrep({ version: 1, input: { dataset: 'branched' }, steps: [] }, [source], { datasets: [{ id: 'branched', pipeline }] });
  assert.deepEqual(plan.columns, source.columns);
  assert.match(plan.sql, /FROM "__prep_1" LIMIT 101$/);
  assert.equal(plan.stages.length, 0);
});
