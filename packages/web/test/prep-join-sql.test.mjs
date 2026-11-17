import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { PrepJoinEditor } from '../build/test/PrepJoinEditor.js';
import { newPrepStep } from '../build/test/data-prep.js';
const columns = [{ name: 'id', type: 'INTEGER' }, { name: 'amount', type: 'DECIMAL' }];
async function mount(t, component, props) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui; await act(async () => { ui = create(createElement(component, props)); });
  t.after(async () => { await act(async () => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  return ui;
}
test('new joins have no keys; suggestions apply only after an explicit confirmation', async t => {
  const step = newPrepStep('join', columns, [{ id: 'a', columns, connectorId: 'file', available: true }], 'a');
  assert.deepEqual(step.config.keys, []);
  const changes = [];
  const props = { config: step.config, leftColumns: columns, rightColumns: columns, leftInput: 'Left', rightInput: 'Right', outputs: null, change: c => changes.push(c) };
  const ui = await mount(t, PrepJoinEditor, props);
  assert.equal(changes.length, 0);
  const suggestion = ui.root.findAllByType('button').find(b => [].concat(b.props.children).join('') === 'Use suggested key: id = id');
  await act(async () => suggestion.props.onClick());
  assert.deepEqual(changes[0].keys, [{ left: 'id', right: 'id' }]);
  await act(async () => ui.update(createElement(PrepJoinEditor, { ...props, config: changes[0] })));
  assert.equal(ui.root.findAllByType('button').filter(b => [].concat(b.props.children).join('') === 'Use suggested key: id = id').length, 0);
  assert.deepEqual(step.config.keys, []);
});
test('Venn picker exposes exactly four labeled compiler join types and keyboard navigation', async t => {
  const config = { source: 'b', joinType: 'left', keys: [{ left: 'id', right: 'id' }], prefix: 'r_' };
  const changes = [];
  const ui = await mount(t, PrepJoinEditor, { config, leftColumns: columns, rightColumns: columns, change: c => changes.push(c) });
  const radios = ui.root.findAllByProps({ role: 'radio' });
  assert.deepEqual(radios.map(r => r.props['aria-label']), ['Left join', 'Inner join', 'Right join', 'Full join']);
  assert.equal(radios.filter(r => r.props['aria-checked']).length, 1);
  for (const [i, radio] of radios.entries()) {
    assert.equal(radio.findByType('span').props.children, radio.props['aria-label']);
    assert.equal(radio.findByType('svg').findAllByType('circle').length, 2);
    assert.equal(radio.findByType('svg').findAllByType('path').length, [2,1,2,3][i]);
    await act(async () => radio.props.onClick());
  }
  assert.deepEqual(changes.map(c => c.joinType), ['left', 'inner', 'right', 'full']);
  for (const [index, key, expected] of [[0,'ArrowRight','inner'],[0,'ArrowLeft','full'],[2,'Home','left'],[1,'End','full']]) {
    await act(async () => radios[index].props.onKeyDown({ key, preventDefault() {}, currentTarget: {} }));
    assert.equal(changes.at(-1).joinType, expected);
    assert.deepEqual(changes.at(-1).keys, config.keys);
  }
});

import { compilePrep } from '@opensight/query-engine';
import { PrepSqlView } from '../build/test/PrepSqlView.js';
import { PrepStepEditor } from '../build/test/PrepStepEditor.js';
import { DataPrep } from '../build/test/DataPrep.js';
import { prepStepPlan, prepPrefix } from '../build/test/data-prep.js';
const sources = ['a', 'b'].map(id => ({ id, connectorId: 'file', columns, available: true }));
const physical = sources.map(s => ({ ...s, table: s.id, security: 'unrestricted' }));
const join = { id: 'j', kind: 'join', config: { source: 'b', joinType: 'full', keys: [{ left: 'id', right: 'id' }], prefix: 'r_' } };
const steps = [
  { id: 'r', kind: 'rename', config: { column: 'amount', name: 'value' } },
  { id: 'w', kind: 'window', config: { name: 'rank', function: 'rank', partitionBy: [], orderBy: [{ column: 'value', direction: 'desc' }] } },
  { id: 'f', kind: 'filter', config: { filters: [{ columnName: 'rank', operator: 'EQUALS', value: 1 }] } },
  { id: 'branch', from: 'r', kind: 'select', config: { columns: ['id'] } },
  { ...join, config: { ...join.config, source: { step: 'f' } } },
];
test('step SQL and bound parameters exactly match the shared compiler for both dialects and branches', async t => {
  const pipeline = { version: 1, input: 'a', steps, output: 'r' };
  for (const dialect of ['duckdb', 'postgres']) {
    const inputs = sources.map(s => ({ ...s, connectorId: dialect === 'postgres' ? 'postgresql' : 'file' }));
    const bindings = physical.map(s => ({ ...s, connectorId: dialect === 'postgres' ? 'postgresql' : 'file' }));
    for (const [index, step] of steps.entries()) {
      const expected = compilePrep(prepPrefix(pipeline, index + 1), bindings, { dialect, through: step.id });
      assert.equal(prepStepPlan(pipeline, step, inputs).sql, expected.sql);
      const ui = await mount(t, PrepSqlView, { pipeline, step, sources: inputs });
      assert.equal(ui.root.findByType('code').props.children, expected.sql);
      assert.equal(ui.root.findAllByType('textarea').length, 0);
      if (expected.parameters.length) assert.deepEqual(JSON.parse(ui.root.findByProps({ 'aria-label': 'SQL parameters' }).props.children), expected.parameters);
    }
  }
});
test('SQL view compiles every canvas transformation, preserving quotes and newlines', async t => {
  const cases = [
    { kind: 'changeType', config: { column: 'amount', type: 'STRING' } },
    { kind: 'rename', config: { column: 'amount', name: 'quoted " name <x>' } },
    { kind: 'select', config: { columns: ['id'] } },
    { kind: 'filter', config: { filters: [{ columnName: 'amount', value: 4 }] } },
    { kind: 'calculate', config: { name: 'result', expression: '{amount} * 2' } },
    steps[1].config && { kind: 'window', config: { ...steps[1].config, orderBy: [{ column: 'id', direction: 'asc' }] } },
    { kind: 'aggregate', config: { groupBy: ['id'], measures: [{ column: 'amount', aggregation: 'SUM', name: 'total' }] } },
    join,
    { kind: 'append', config: { source: 'b', duplicates: 'dedupe' } },
    { kind: 'pivot', config: { groupBy: [], column: 'id', value: 'amount', aggregation: 'SUM', values: [{ value: 1, name: 'one' }] } },
    { kind: 'unpivot', config: { columns: ['amount'], nameColumn: 'key', valueColumn: 'value' } },
  ];
  for (const c of cases) {
    const step = { ...c, id: 'step' }, pipeline = { version: 1, input: 'a', steps: [step] };
    const expected = compilePrep(pipeline, physical, { through: step.id });
    const ui = await mount(t, PrepSqlView, { pipeline, step, sources });
    assert.equal(ui.root.findByType('code').props.children, expected.sql, c.kind);
    assert.match(expected.sql, /\nSELECT/);
  }
});
test('SQL view ignores later invalid drafts and resolves prepared inputs with the shared compiler', async t => {
  const dataset = { resourceType: 'dataset', dataSetId: 'saved', opensightPrep: { version: 1, input: 'a', steps: [] } };
  const pipeline = { version: 1, input: { dataset: 'saved' }, steps: [join, { id: 'bad', kind: 'select', config: { columns: ['missing'] } }], output: 'bad' };
  const context = { datasets: [dataset], datasetId: 'editing' };
  const expected = compilePrep(prepPrefix(pipeline, 1), physical, { through: 'j', datasets: [{ id: 'saved', pipeline: dataset.opensightPrep }], datasetId: 'editing' });
  const ui = await mount(t, PrepSqlView, { pipeline, step: join, sources, context });
  assert.equal(ui.root.findByType('code').props.children, expected.sql);
});
test('uncompilable step renders the compiler named error and removes any previous SQL', async t => {
  const pipeline = { version: 1, input: 'a', steps: [join] };
  const ui = await mount(t, PrepSqlView, { pipeline, step: join, sources });
  for (const step of [
    { id: 'bad', kind: 'select', config: { columns: ['missing'] } },
    { id: 'bad', kind: 'window', config: { name: 'n', function: 'rowNumber', partitionBy: [], orderBy: [] } },
  ]) {
    let expected;
    try { prepStepPlan(pipeline, step, sources); } catch (e) { expected = e; }
    assert.ok(expected?.code);
    await act(async () => ui.update(createElement(PrepSqlView, { pipeline, step, sources })));
    assert.equal(ui.root.findByProps({ role: 'alert' }).props.children, `${expected.code}: ${expected.message}`);
    assert.equal(ui.root.findAllByType('code').length, 0);
  }
});
test('SQL in the step editor follows unapplied edits and normalized numeric parameters', async t => {
  const step = { id: 'f', kind: 'filter', config: { filters: [{ columnName: 'amount', value: 4 }] } };
  const pipeline = { version: 1, input: 'a', steps: [step] }, applied = [];
  const ui = await mount(t, PrepStepEditor, { step, pipeline, columns, sources, apply: s => applied.push(s), cancel() {} });
  const input = ui.root.findAllByType('input').find(n => n.props.value === '4');
  await act(async () => input.props.onChange({ target: { value: '-2.5' } }));
  const draft = { ...step, config: { filters: [{ columnName: 'amount', value: -2.5 }] } };
  const expected = compilePrep({ ...pipeline, steps: [draft] }, physical);
  assert.equal(ui.root.findByType('code').props.children, expected.sql);
  assert.deepEqual(JSON.parse(ui.root.findByProps({ 'aria-label': 'SQL parameters' }).props.children), expected.parameters);
  assert.equal(applied.length, 0); assert.equal(step.config.filters[0].value, 4);
});
test('canvas selected step and its editor both expose the SQL view', async t => {
  const pipeline = { version: 1, input: 'a', steps: [join] };
  const resource = { resourceType: 'dataset', dataSetId: 'saved', name: 'Saved', physicalTableMap: {}, opensightPrep: pipeline };
  const client = { async listPrepSources() { return sources; }, async listPrepDatasets() { return { datasets: [resource] }; }, async previewPrep() { return { rows: [] }; } };
  const ui = await mount(t, DataPrep, { client, initialDatasetId: 'saved' });
  const node = ui.root.findAllByType('button').find(n => n.props.className?.split(' ').includes('prep-node') && n.findAllByType('strong').some(s => s.props.children === 'Join'));
  await act(async () => node.props.onClick());
  const expected = compilePrep(pipeline, physical, { through: 'j' }).sql;
  assert.equal(ui.root.findByType('code').props.children, expected);
  await act(async () => ui.root.findAllByType('button').find(n => n.props.children === 'Configure step').props.onClick());
  assert.equal(ui.root.findByType(PrepStepEditor).findByType('code').props.children, expected);
});
