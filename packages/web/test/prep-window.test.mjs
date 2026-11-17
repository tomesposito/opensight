import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { DuckDBInstance } from '@duckdb/node-api';
import { PGlite } from '@electric-sql/pglite';
import { prepWindowFunctions, validatePrepPipeline } from '@opensight/bundle-parser/prep';
import { compilePrep } from '@opensight/query-engine';
import { PrepStepEditor } from '../build/test/PrepStepEditor.js';
import { PrepStepIcon } from '../build/test/PrepIcons.js';
import { DataPrep } from '../build/test/DataPrep.js';
import { newPrepStep, prepKeepFirstRecipe, prepWindowDefaults, prepWindowExpression, prepPlan, prepCatalog } from '../build/test/data-prep.js';

const columns = [{ name: 'team', type: 'STRING' }, { name: 'id', type: 'INTEGER' }, { name: 'value', type: 'DECIMAL' }];
const source = { id: 'events', connectorId: 'file', columns, available: true };
const pipeline = steps => ({ version: 1, input: 'events', steps });
async function mount(t, component, props) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui; await act(async () => { ui = create(createElement(component, props)); });
  t.after(async () => { await act(async () => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  return ui;
}
const control = (ui, label) => ui.root.findAll(n => typeof n.type === 'string' && n.props['aria-label'] === label)[0];
const change = async (ui, label, value, checkbox = false) => act(async () => control(ui, label).props.onChange({ target: checkbox ? { checked: value } : { value } }));
const submit = async ui => act(async () => ui.root.findByProps({ className: 'prep-step-editor' }).props.onSubmit({ preventDefault() {} }));
async function selectColumn(ui, legend, name, checked) {
  const fieldset = ui.root.findAllByType('fieldset').find(f => f.findByType('legend').props.children === legend);
  await act(async () => fieldset.findByProps({ 'data-column': name }).findByType('input').props.onChange({ target: { checked } }));
}
const editorProps = (step, apply) => ({ step, columns, sources: [source], apply, cancel() {}, validate: s => prepPlan(pipeline([s]), [source]) });

test('Window catalog, icon and defaults are usable and output names avoid case collisions', () => {
  assert.equal(prepCatalog.find(c => c.kind === 'window').group, 'Column transformations');
  const step = newPrepStep('window', columns, [source], 'events');
  assert.deepEqual(step.config, { name: 'row_number', function: 'rowNumber', partitionBy: [], orderBy: [{ column: 'team', direction: 'asc' }] });
  assert.ok(renderToStaticMarkup(createElement(PrepStepIcon, { kind: 'window' })).includes('▥'));
  assert.equal(newPrepStep('window', [...columns, { name: 'ROW_NUMBER', type: 'INTEGER' }], [source], 'events').config.name, 'row_number_1');
  assert.deepEqual(newPrepStep('window', [], [], 'events').config.orderBy, []);
  for (const fn of prepWindowFunctions) {
    const config = prepWindowDefaults(fn, columns);
    validatePrepPipeline(pipeline([{ id: 'w', kind: 'window', config }]));
    const structured = prepPlan(pipeline([{ id: 'w', kind: 'window', config }]), [source]);
    const advanced = prepPlan(pipeline([{ id: 'w', kind: 'window', config: { name: config.name, expression: prepWindowExpression(config) } }]), [source]);
    assert.equal(advanced.sql, structured.sql, fn);
    if (config.valueColumn !== undefined) assert.equal(config.valueColumn, 'id');
  }
});
test('recipe helper is collision-safe and fails with the named order error until configured', () => {
  const steps = prepKeepFirstRecipe([...columns, { name: '__KEEP_ROW_NUMBER', type: 'INTEGER' }, { name: '__keep_row_number_1', type: 'INTEGER' }]);
  assert.equal(steps.length, 2); assert.equal(steps[0].config.name, '__keep_row_number_2');
  assert.deepEqual(steps[0].config.orderBy, []);
  assert.deepEqual(steps[1].config.filters, [{ columnName: '__keep_row_number_2', operator: 'EQUALS', value: 1 }]);
  assert.equal(steps[1].from, steps[0].id); assert.notEqual(steps[0].id, steps[1].id);
  assert.throws(() => prepPlan(pipeline(steps), [source]), e => e.code === 'PREP_WINDOW_ORDER_REQUIRED');
});
test('keep first/latest recipe runs end to end over repeated groups in DuckDB and Postgres', async t => {
  const db = await DuckDBInstance.create(':memory:', { threads: '1' }), duck = await db.connect(), pg = new PGlite();
  t.after(async () => { duck.closeSync(); db.closeSync(); await pg.close(); });
  const sql = "CREATE TABLE events (team VARCHAR, id BIGINT, value DOUBLE PRECISION); INSERT INTO events VALUES ('A',1,5),('A',2,5),('B',3,9),('B',4,9),('B',5,9);";
  await duck.run(sql); await pg.exec(sql);
  for (const dialect of ['duckdb', 'postgres']) for (const direction of ['asc', 'desc']) {
    const steps = prepKeepFirstRecipe(columns);
    steps[0].config.partitionBy = ['team']; steps[0].config.orderBy = [{ column: 'id', direction }];
    const p = compilePrep(pipeline(steps), [{ ...source, table: 'events', security: 'unrestricted', connectorId: dialect === 'postgres' ? 'postgresql' : 'file' }], { dialect });
    const rows = dialect === 'postgres' ? (await pg.query(p.sql, p.parameters)).rows : (await duck.runAndReadAll(p.sql, p.parameters)).getRowObjects();
    assert.deepEqual(rows.map(r => Number(r.id)).sort(), direction === 'asc' ? [1,3] : [2,5]);
    assert.ok(rows.every(r => Number(r[steps[0].config.name]) === 1));
  }
});
test('structured editor configures value, partition, order priority/direction, moving bounds and function-specific fields', async t => {
  let applied;
  const ui = await mount(t, PrepStepEditor, editorProps(newPrepStep('window', columns, [source], 'events'), s => { applied = s; }));
  await change(ui, 'Output name', 'rolling'); await change(ui, 'Function', 'movingSum');
  await change(ui, 'Value column', 'value');
  await selectColumn(ui, 'Partition by (restart for each)', 'team', true);
  await selectColumn(ui, 'Order by (first to last priority)', 'id', true);
  await change(ui, 'Direction for id', 'desc');
  const order = ui.root.findAllByType('fieldset').find(f => f.findByType('legend').props.children === 'Order by (first to last priority)');
  await act(async () => order.findByProps({ 'data-column': 'id' }).props.onKeyDown({ altKey: true, key: 'ArrowUp', preventDefault() {} }));
  await change(ui, 'Rows before', '2'); await change(ui, 'Rows after', '1');
  await submit(ui);
  assert.deepEqual(applied.config, { name: 'rolling', function: 'movingSum', valueColumn: 'value', partitionBy: ['team'], orderBy: [{ column: 'id', direction: 'desc' }, { column: 'team', direction: 'asc' }], frameBefore: 2, frameAfter: 1 });
  await change(ui, 'Rows before', '-1'); assert.equal(ui.root.findByProps({ type: 'submit' }).props.disabled, true);
  await change(ui, 'Function', 'ntile'); await change(ui, 'Buckets', '3'); await submit(ui);
  assert.equal(applied.config.buckets, 3); assert.equal(Object.hasOwn(applied.config, 'frameBefore'), false); assert.equal(Object.hasOwn(applied.config, 'valueColumn'), false);
  await change(ui, 'Buckets', '0'); assert.equal(ui.root.findByProps({ type: 'submit' }).props.disabled, true);
  await change(ui, 'Function', 'lag'); await change(ui, 'Value column', 'team'); await change(ui, 'Offset', '2'); await submit(ui);
  assert.equal(applied.config.valueColumn, 'team'); assert.equal(applied.config.offset, 2); assert.equal(Object.hasOwn(applied.config, 'buckets'), false);
  await change(ui, 'Offset', ''); assert.equal(ui.root.findByProps({ type: 'submit' }).props.disabled, true);
  await change(ui, 'Function', 'rowNumber'); await submit(ui);
  assert.equal(Object.hasOwn(applied.config, 'offset'), false); assert.equal(Object.hasOwn(applied.config, 'valueColumn'), false);
  await selectColumn(ui, 'Order by (first to last priority)', 'id', false); await selectColumn(ui, 'Order by (first to last priority)', 'team', false);
  assert.equal(ui.root.findByProps({ type: 'submit' }).props.disabled, true); assert.match(JSON.stringify(ui.toJSON()), /PREP_WINDOW_ORDER_REQUIRED/);
});
test('advanced editor uses the dedicated grammar, blocks unsupported SQL and retains separate drafts', async t => {
  let applied;
  const ui = await mount(t, PrepStepEditor, editorProps(newPrepStep('window', columns, [source], 'events'), s => { applied = s; }));
  await change(ui, 'Advanced mode', true, true);
  assert.equal(control(ui, 'Window expression').props.value, 'ROW_NUMBER() OVER (ORDER BY "team" ASC)');
  await change(ui, 'Window expression', 'LAG(team, 2) OVER (ORDER BY id DESC)'); await submit(ui);
  assert.deepEqual(applied.config, { name: 'row_number', expression: 'LAG(team, 2) OVER (ORDER BY id DESC)' });
  await change(ui, 'Window expression', 'SUM(value) OVER (ORDER BY id) + 1');
  assert.equal(ui.root.findByProps({ type: 'submit' }).props.disabled, true);
  await change(ui, 'Advanced mode', false, true); assert.equal(control(ui, 'Function').props.value, 'rowNumber');
  await change(ui, 'Advanced mode', true, true); assert.equal(control(ui, 'Window expression').props.value, 'SUM(value) OVER (ORDER BY id) + 1');
});
test('append editor defaults to keep without adding a property, persists dedupe across source changes', async t => {
  let applied;
  const step = { id: 'a', kind: 'append', config: { source: 'events' } };
  const ui = await mount(t, PrepStepEditor, { ...editorProps(step, s => { applied = s; }), sources: [source, { ...source, id: 'other' }], validate: undefined });
  assert.equal(control(ui, 'Duplicates').props.value, 'Keep all rows'); await submit(ui); assert.deepEqual(applied, step);
  await change(ui, 'Duplicates', 'Remove duplicate rows'); await change(ui, 'Append source', 'other'); await submit(ui);
  assert.deepEqual(applied.config, { source: 'other', duplicates: 'dedupe' });
  await change(ui, 'Duplicates', 'Keep all rows'); await submit(ui); assert.equal(applied.config.duplicates, 'keep');
});
test('one click inserts both recipe nodes, opens the window editor and can repair order then show the filtered schema', async t => {
  const ui = await mount(t, DataPrep, {});
  const button = label => ui.root.findAllByType('button').find(b => b.props.children === label);
  await act(async () => button('Keep first/latest row per group').props.onClick());
  assert.equal(ui.root.findAllByProps({ className: 'prep-node-wrap' }).length, 4);
  assert.match(JSON.stringify(ui.toJSON()), /PREP_WINDOW_ORDER_REQUIRED/);
  const editor = ui.root.findByType(PrepStepEditor), first = editor.props.columns[0].name;
  await selectColumn(ui, 'Partition by (restart for each)', first, true);
  await selectColumn(ui, 'Order by (first to last priority)', first, true);
  assert.equal(ui.root.findByProps({ type: 'submit' }).props.disabled, false);
  await submit(ui);
  assert.doesNotMatch(JSON.stringify(ui.toJSON()), /PREP_WINDOW_ORDER_REQUIRED/);
  assert.match(JSON.stringify(ui.toJSON()), /__keep_row_number/);
});

test('recipe insertion rejects the two-step workflow overflow without changing the saved draft', async t => {
  const steps = Array.from({ length: 49 }, (_, i) => ({ id: `s${i}`, kind: 'select', config: { columns: ['team', 'id', 'value'] } }));
  const resource = { resourceType: 'dataset', dataSetId: 'many-steps', name: 'Many steps', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: pipeline(steps) };
  const client = {
    async listPrepSources() { return [source]; },
    async listPrepDatasets() { return { datasets: [resource], persistence: 'file' }; },
    async previewPrep() { return { columns, rows: [], totalRows: 0, truncated: false }; },
  };
  const ui = await mount(t, DataPrep, { client, initialDatasetId: 'many-steps' });
  const button = ui.root.findAllByType('button').find(b => b.props.children === 'Keep first/latest row per group');
  assert.equal(button.props.disabled, false);
  await act(async () => button.props.onClick());
  assert.match(JSON.stringify(ui.toJSON()), /At most 50 steps/);
  assert.equal(ui.root.findAllByProps({ className: 'prep-node-wrap' }).length, 51); // input/output + original 49
  assert.equal(ui.root.findAllByType(PrepStepEditor).length, 0);
});
