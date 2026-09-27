import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { functionCatalog } from '@opensight/query-engine/browser';
import { CalculationDialog } from '../build/test/Author.js';
import { calculationError, expressionError, dataFields, emptyDraft, serializeDraft } from '../build/test/authoring.js';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';

test('editor validates every catalog example with the execution parser', () => {
  for (const f of functionCatalog) assert.equal(expressionError(f.example, dataFields()), undefined, f.name);
  for (const [expression, functionName] of [["substring({region}, 1)", 'substring'], ['round({region})', 'round'], ["ifelse({revenue}, 1, 0)", 'ifelse'], ['sum(sum({revenue}))', 'sum'], ['sumOver(sum({revenue}), [], PRE_AGG)', 'sumOver'], ['unknownOne(1)', 'unknownOne']]) {
    const error = calculationError({ name: 'Calculation', expression, role: 'measure' }, dataFields());
    assert.ok(error?.includes(functionName), expression); if (functionName !== 'unknownOne') assert.match(error, /Expected /);
  }
  assert.match(expressionError('({revenue}', dataFields()), /expected '\)'/);
});
test('function picker exposes signatures, inserts examples, and blocks invalid syntax', async t => {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, saved;
  await act(() => { renderer = create(createElement(CalculationDialog, { fields: [], onSave: field => { saved = field; }, onClose() {} })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const select = renderer.root.findAllByType('select').find(s => s.props.value === 'concat');
  assert.equal(select.findAllByType('option').length, functionCatalog.length);
  await act(() => select.props.onChange({ target: { value: 'substring' } }));
  assert.ok(renderer.root.findAllByType('code').some(c => c.props.children === 'substring(string, start, length)'));
  await act(() => renderer.root.findAllByType('button').find(b => b.props.children === 'Use example').props.onClick());
  assert.equal(renderer.root.findByType('textarea').props.value, 'substring({region}, 1, 2)');
  await act(() => renderer.root.findByType('input').props.onChange({ target: { value: 'Short region' } }));
  await act(() => renderer.root.findAllByType('select')[0].props.onChange({ target: { value: 'dimension' } }));
  await act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: 'substring({region}, 1)' } }));
  await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(saved, undefined); assert.match(renderer.root.findByProps({ role: 'alert' }).props.children, /substring.*Expected substring/);
  await act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '  substring({region}, 1, 2)  ' } }));
  await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(saved.expression, '  substring({region}, 1, 2)  ');
});
test('import names every unsupported function per expression and preserves exact bundle text', () => {
  for (const remote of [false, true]) {
    const analysis = serializeDraft(emptyDraft());
    if (remote) analysis.definition.dataSetIdentifierDeclarations[0].dataSetArn = 'arn:aws:quicksight:us-east-1:123456789012:dataset/remote';
    analysis.definition.calculatedFields = [
      { name: 'Unsupported one', dataSetIdentifier: 'sales_data', expression: '  mysteryOne({revenue}) + mysteryTwo(2)\n' },
      { name: 'Unsupported two', dataSetIdentifier: 'sales_data', expression: 'mysteryTwo({profit})' },
      { name: 'Supported', dataSetIdentifier: 'sales_data', expression: "concat('mysteryThree(1)', {region})" },
    ];
    const original = { members: [{ path: 'analysis/authored-analysis.json', resource: analysis }] }, draft = importBundle(original);
    const messages = draft.bundle.report.flatMap(r => r.messages);
    assert.ok(messages.some(m => /Unsupported one.*mysteryOne, mysteryTwo/.test(m)));
    assert.ok(messages.some(m => /Unsupported two.*mysteryTwo/.test(m)));
    assert.ok(!messages.some(m => /unsupported functions:.*mysteryThree/.test(m)));
    assert.deepEqual(exportBundle(draft).members[0].resource.definition.calculatedFields, analysis.definition.calculatedFields);
  }
});
test('client query executes scalar, aggregate and table functions together', () => {
  const result = executeFixtureQuery({ dimensions: [{ fieldId: 'region', columnName: 'region' }], measures: [{ fieldId: 'share', columnName: 'Share', aggregation: 'SUM' }], filters: [], calculatedFields: [
    { name: 'Rounded', expression: 'round({revenue}, 2)' }, { name: 'Share', expression: 'percentOfTotal(sum({Rounded}))' },
  ] });
  assert.deepEqual(result, { rows: [{ region: 'East', share: 500/900 }, { region: 'West', share: 400/900 }] });
});

test('calculated datetime dimensions retain their type through export, import and fixture execution', async () => {
  const { authorReducer, activeSheet } = await import('../build/test/authoring.js');
  const { buildAuthorQuery } = await import('../build/test/author-query.js');
  let draft = authorReducer(emptyDraft(), { type: 'add', kind: 'line' });
  draft = authorReducer(draft, { type: 'calculation-add', field: { name: 'Next month', expression: "addDateTime(1, 'MM', {order_date})", role: 'dimension' } });
  draft = authorReducer(draft, { type: 'assign', field: 'Next month', well: 'dimension' });
  assert.equal(dataFields(draft.calculatedFields).find(f => f.name === 'Next month').type, 'DATETIME');
  const resource = serializeDraft(draft), exported = resource.definition.sheets[0].visuals[0].lineChartVisual.chartConfiguration.fieldWells.lineChartAggregatedFieldWells.category[0];
  assert.equal(exported.dateDimensionField.column.columnName, 'Next month');
  const imported = importBundle({ members: [{ path: 'analysis/authored-analysis.json', resource }] });
  const visual = activeSheet(imported).visuals[0];
  assert.deepEqual(visual.imported.issues, []);
  const query = buildAuthorQuery(visual, imported.calculatedFields);
  assert.equal(query.dimensions[0].granularity, 'MONTH');
  assert.deepEqual(executeFixtureQuery(query).rows, [{ month: '2025-02', revenue: 600 }, { month: '2025-04', revenue: 50 }, { month: '2025-05', revenue: 250 }]);
});
