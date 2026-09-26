import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBundleResource } from '@opensight/bundle-parser';
import {
  SALES_FIELDS, VISUAL_TYPES, DRAFT_KEY, authorReducer, emptyDraft,
  serializeVisual, serializeDraft, validateDraft, loadDraft, saveDraft,
} from '../build/test/authoring.js';
import { buildAuthorPreview } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';
import { init } from '../build/test/echarts.js';

const add = (kind = 'bar') => authorReducer(emptyDraft(), { type: 'add', kind });
const edit = (draft, ...actions) => actions.reduce(authorReducer, draft);
const assign = field => ({ type: 'assign', field });
const unassign = field => ({ type: 'unassign', field });
const visual = draft => draft.visuals.find(v => v.id === draft.selectedId);
const body = definition => Object.values(definition)[0];

test('sales field names and type badges match the pinned dataset', async () => {
  const dataset = JSON.parse(await readFile(new URL('../../../fixtures/renderable-sales/describe-data-set.response.json', import.meta.url), 'utf8'));
  assert.deepEqual(SALES_FIELDS.map(f => ({ Name: f.name, Type: f.type })), dataset.DataSet.OutputColumns);
  assert.deepEqual(SALES_FIELDS.filter(f => f.role === 'measure').map(f => f.name), ['revenue', 'profit']);
});

test('assignment replaces the dimension, appends unique measures, and preserves the prior draft', () => {
  const before = add();
  const original = structuredClone(before);
  const draft = edit(before, assign('category'), assign('profit'), assign('revenue'));
  assert.deepEqual(before, original);
  assert.equal(visual(draft).dimension, 'category');
  assert.deepEqual(visual(draft).measures, ['revenue', 'profit']);
  assert.deepEqual(serializeDraft(draft), [{ barChartVisual: {
    visualId: 'visual-1', chartConfiguration: { fieldWells: { barChartAggregatedFieldWells: {
      category: [{ categoricalDimensionField: { fieldId: 'category', column: { dataSetIdentifier: 'sales_data', columnName: 'category' } } }],
      values: ['revenue', 'profit'].map(name => ({ numericalMeasureField: {
        fieldId: name, column: { dataSetIdentifier: 'sales_data', columnName: name },
        aggregationFunction: { simpleNumericalAggregation: 'SUM' },
      } })),
    } } },
  } }]);
});

test('date and numerical dimensions serialize with the right variants and fixed month grain', () => {
  for (const [field, variant] of [['order_date', 'dateDimensionField'], ['order_id', 'numericalDimensionField']]) {
    const definition = serializeDraft(edit(add('line'), assign(field)))[0];
    const dimension = definition.lineChartVisual.chartConfiguration.fieldWells.lineChartAggregatedFieldWells.category[0];
    assert.deepEqual(dimension, { [variant]: {
      fieldId: field, column: { dataSetIdentifier: 'sales_data', columnName: field },
      ...(field === 'order_date' ? { dateGranularity: 'MONTH' } : {}),
    } });
  }
});

test('table uses groupBy and KPI has values without a dimension well', () => {
  const table = serializeDraft(add('table'))[0].tableVisual.chartConfiguration.fieldWells.tableAggregatedFieldWells;
  assert.ok(table.groupBy);
  assert.equal(table.category, undefined);
  const kpi = edit(add('kpi'), assign('region'), assign('profit'));
  assert.equal(visual(kpi).dimension, null);
  assert.deepEqual(visual(kpi).measures, ['profit']);
  assert.deepEqual(Object.keys(serializeDraft(kpi)[0].kpiVisual.chartConfiguration.fieldWells), ['values']);
});

test('pie replaces its single measure and donut is serialized as an arc option', () => {
  const draft = edit(add('pie'), assign('profit'), { type: 'donut', donut: true });
  const config = serializeDraft(draft)[0].pieChartVisual.chartConfiguration;
  assert.deepEqual(visual(draft).measures, ['profit']);
  assert.equal(config.donutOptions.arcOptions.arcThickness, 'MEDIUM');
  assert.equal(serializeDraft(add('pie'))[0].pieChartVisual.chartConfiguration.donutOptions.arcOptions.arcThickness, 'WHOLE');
});

test('type changes retain compatible wells and remove incompatible dimensions, measures and donut state', () => {
  const bar = edit(add(), assign('profit'));
  const pie = edit(bar, { type: 'kind', kind: 'pie' }, { type: 'donut', donut: true });
  assert.deepEqual(visual(pie).measures, ['revenue']);
  assert.equal(visual(pie).dimension, 'region');
  const kpi = edit(pie, { type: 'kind', kind: 'kpi' });
  assert.equal(visual(kpi).dimension, null);
  assert.equal(visual(kpi).donut, false);
  const table = edit(kpi, { type: 'kind', kind: 'table' });
  assert.throws(() => serializeDraft(table), /exactly one category/);
  assert.doesNotThrow(() => serializeDraft(edit(table, assign('category'))));
});

test('removed wells remain in drafts but prevent export until repaired', () => {
  let draft = edit(add(), unassign('revenue'), unassign('region'));
  validateDraft(draft);
  assert.deepEqual(visual(draft).measures, []);
  assert.equal(visual(draft).dimension, null);
  assert.throws(() => serializeDraft(draft), /exactly one category/);
  draft = edit(draft, assign('region'));
  assert.throws(() => serializeDraft(draft), /expected supported number of measures/);
  draft = edit(draft, assign('revenue'));
  assert.equal(serializeDraft(draft).length, 1);
});

test('configuration only edits the selected visual; title is trimmed plain text', () => {
  const first = add();
  const second = edit(first, { type: 'add', kind: 'line' });
  const draft = edit(second, { type: 'select', id: first.selectedId }, { type: 'title', title: '  <b>Sales</b>  ' }, assign('category'));
  assert.deepEqual(draft.visuals[1], second.visuals[1]);
  assert.deepEqual(body(serializeDraft(draft)[0]).title, { visibility: 'VISIBLE', formatText: { plainText: '<b>Sales</b>' } });
  assert.equal(body(serializeDraft(first)[0]).title, undefined);
});

test('move preserves selection and identities, defines export order, and stops at canvas edges', () => {
  const draft = edit(add(), { type: 'add', kind: 'line' }, { type: 'add', kind: 'pie' });
  const moved = edit(draft, { type: 'move', id: 'visual-3', offset: -1 });
  assert.equal(moved.selectedId, 'visual-3');
  assert.deepEqual(serializeDraft(moved).map(v => body(v).visualId), ['visual-1', 'visual-3', 'visual-2']);
  assert.deepEqual(draft.visuals.map(v => v.id), ['visual-1', 'visual-2', 'visual-3']);
  assert.equal(authorReducer(moved, { type: 'move', id: 'visual-1', offset: -1 }), moved);
  assert.equal(authorReducer(moved, { type: 'move', id: 'visual-2', offset: 1 }), moved);
  for (const type of ['select', 'move', 'remove']) {
    assert.equal(authorReducer(moved, { type, id: 'missing', offset: 1 }), moved);
  }
});

test('removal selects an adjacent card, handles the last card, and new IDs stay unique', () => {
  let draft = edit(add(), { type: 'add', kind: 'line' }, { type: 'add', kind: 'pie' }, { type: 'select', id: 'visual-2' });
  draft = edit(draft, { type: 'remove', id: 'visual-2' });
  assert.equal(draft.selectedId, 'visual-3');
  draft = edit(draft, { type: 'add', kind: 'table' });
  assert.equal(new Set(draft.visuals.map(v => v.id)).size, 3);
  draft = edit(draft, { type: 'remove', id: 'visual-1' });
  assert.equal(draft.selectedId, 'visual-2');
  draft = edit(draft, { type: 'remove', id: 'visual-2' });
  assert.equal(draft.selectedId, 'visual-3');
  assert.deepEqual(edit(draft, { type: 'remove', id: 'visual-3' }), emptyDraft());
});

for (const { kind } of VISUAL_TYPES) {
  test(`authored ${kind} JSON round-trips through bundle-parser and compiler with fixture results`, () => {
    const draft = add(kind);
    const definitions = JSON.parse(JSON.stringify(serializeDraft(draft)));
    const resource = parseBundleResource({
      resourceType: 'analysis', analysisId: 'test-author', name: 'Test author',
      definition: { dataSetIdentifierDeclarations: [{ identifier: 'sales_data', dataSetArn: 'test-only' }], sheets: [{ sheetId: 'test', visuals: definitions }] },
    });
    const input = buildAuthorPreview(visual(draft));
    const before = structuredClone(input);
    const compiled = compileVisual({ ...input, definition: resource.definition.sheets[0].visuals[0] });
    assert.deepEqual(input, before);
    assert.equal(compiled.model.kind, kind);
    assert.equal(compiled.state, 'ready');
    assert.equal(compiled.option.animation, false);
    assert.ok(compiled.table.rows.length);
    if (kind === 'table') {
      assert.deepEqual(compiled.table, { columns: ['region', 'revenue'], rows: [['East', 500]] });
      assert.equal(compiled.option.series, undefined);
    } else {
      const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 320 });
      try {
        chart.setOption(compiled.option);
        const svg = chart.renderToSVGString();
        assert.match(svg, /<svg[^>]+width="600"/);
        assert.doesNotMatch(svg, /NaN|Infinity/);
        if (kind === 'kpi') assert.match(svg, />500<\/text>/);
      } finally { chart.dispose(); }
    }
    if (kind === 'line') {
      assert.deepEqual(compiled.option.xAxis.data, ['2025-01', '2025-03', '2025-04']);
      assert.deepEqual(compiled.option.series[0].data, [400, 0, 100]);
    }
    if (kind === 'bar') assert.deepEqual(compiled.option.series[0].data, [500]);
    if (kind === 'pie') assert.deepEqual(compiled.option.series[0].data, [{ name: 'Hardware', value: 200 }, { name: 'Software', value: 300 }]);
  });
}

test('authored donut compiles its serialized arc without changing sample slices', () => {
  const draft = edit(add('pie'), { type: 'donut', donut: true });
  const compiled = compileVisual(buildAuthorPreview(visual(draft)));
  assert.deepEqual(compiled.option.series[0].radius, ['42%', '70%']);
  assert.deepEqual(compiled.option.series[0].data.map(s => s.value), [200, 300]);
});

test('preview uses only the explicit reviewed revenue grains for every chart kind', () => {
  for (const kind of ['bar', 'line', 'pie', 'table']) {
    for (const dimension of ['region', 'category', 'order_date']) {
      const authored = visual(edit(add(kind), assign(dimension)));
      const preview = buildAuthorPreview(authored);
      const compiled = compileVisual(preview);
      assert.equal(compiled.state, 'ready', `${kind}/${dimension}`);
      assert.deepEqual(preview.bindings, dimension === 'order_date' ? { order_date: 'month' } : {});
      assert.equal(compiled.table.rows.reduce((sum, row) => sum + row[1], 0), 500);
    }
  }
});

test('profit, order IDs and multiple values never reuse unrelated or partial oracle results', () => {
  for (const { kind } of VISUAL_TYPES) {
    const profit = visual(edit(add(kind), unassign('revenue'), assign('profit')));
    const preview = buildAuthorPreview(profit);
    assert.equal(preview.rows, null);
    assert.equal(compileVisual(preview).state, 'unavailable');
    assert.doesNotThrow(() => serializeDraft({ version: 1, visuals: [profit], selectedId: profit.id }));
    if (kind !== 'kpi') {
      assert.equal(buildAuthorPreview(visual(edit(add(kind), assign('order_id')))).rows, null);
    }
    if (kind !== 'pie' && kind !== 'kpi') {
      const multiple = buildAuthorPreview(visual(edit(add(kind), assign('profit'))));
      assert.equal(multiple.rows, null);
      assert.equal(compileVisual(multiple).state, 'unavailable');
    }
  }
});

test('export contains definitions only, with no rows, UI state or implied preview filters', () => {
  const definition = serializeDraft(add())[0];
  assert.deepEqual(Object.keys(definition), ['barChartVisual']);
  assert.deepEqual(Object.keys(body(definition)), ['visualId', 'chartConfiguration']);
  assert.doesNotMatch(JSON.stringify(definition), /East|rows|selectedId|version|filterGroups/);
  assert.deepEqual(serializeVisual(visual(add())), definition);
});

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem(key) { assert.equal(key, DRAFT_KEY); return value; },
    setItem(key, next) { assert.equal(key, DRAFT_KEY); value = next; },
  };
}

test('localStorage saves and restores selected card, ordering and unfinished wells', () => {
  const store = memoryStorage();
  assert.deepEqual(loadDraft(() => store), { draft: emptyDraft() });
  const draft = edit(add(), { type: 'add', kind: 'line' }, { type: 'move', id: 'visual-2', offset: -1 }, unassign('revenue'));
  assert.equal(saveDraft(draft, () => store), 'Draft saved on this device.');
  assert.deepEqual(loadDraft(() => store), { draft });
});

for (const [name, corrupt] of [
  ['unsupported version', draft => { draft.version = 2; }],
  ['extra data', draft => { draft.rows = [{ revenue: 999 }]; }],
  ['missing selection', draft => { draft.selectedId = 'missing'; }],
  ['null selection with cards', draft => { draft.selectedId = null; }],
  ['duplicate IDs', draft => { draft.visuals.push(structuredClone(draft.visuals[0])); }],
  ['unsafe ID', draft => { draft.visuals[0].id = '../invalid'; }],
  ['unknown kind', draft => { draft.visuals[0].kind = 'scatter'; }],
  ['unknown field', draft => { draft.visuals[0].dimension = 'country'; }],
  ['wrong field role', draft => { draft.visuals[0].measures = ['region']; }],
  ['duplicate measures', draft => { draft.visuals[0].measures = ['revenue', 'revenue']; }],
  ['KPI dimension', draft => { draft.visuals[0].kind = 'kpi'; }],
  ['multiple pie values', draft => { draft.visuals[0].kind = 'pie'; draft.visuals[0].measures.push('profit'); }],
  ['invalid donut', draft => { draft.visuals[0].donut = true; }],
  ['nontext title', draft => { draft.visuals[0].title = 42; }],
]) {
  test(`untrusted draft rejects ${name} without overwriting storage`, () => {
    const draft = add();
    corrupt(draft);
    assert.throws(() => validateDraft(draft), /Invalid or unsupported/);
    const saved = JSON.stringify(draft);
    const store = memoryStorage(saved);
    const restored = loadDraft(() => store);
    assert.deepEqual(restored.draft, emptyDraft());
    assert.match(restored.warning, /could not be restored/);
    assert.equal(store.getItem(DRAFT_KEY), saved);
  });
}

test('malformed JSON and denied storage access are recoverable; quota errors suggest export', () => {
  for (const text of ['{broken', 'null', '[]']) {
    assert.match(loadDraft(() => memoryStorage(text)).warning, /could not be restored/);
  }
  const denied = () => { throw new Error('Storage disabled'); };
  assert.match(loadDraft(denied).warning, /could not be restored/);
  assert.match(saveDraft(add(), denied), /Export JSON/);
  assert.match(saveDraft(add(), () => ({ setItem() { throw new Error('QuotaExceededError'); } })), /Export JSON/);
});
