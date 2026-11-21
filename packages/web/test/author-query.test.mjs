import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApiClient, QueryError } from '../build/test/api-client.js';
import { activeSheet, authorReducer, emptyDraft, serializeVisual, validateDraft } from '../build/test/authoring.js';
import { normalizeInsight } from '../build/test/insight-configuration.js';
import { buildAuthorQuery, loadAuthorRows } from '../build/test/author-query.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { Author, AuthorCanvas } from '../build/test/Author.js';

const draft = kind => authorReducer(emptyDraft(), { type: 'add', kind });
const visual = kind => activeSheet(draft(kind)).visuals[0];
const render = (item, data, props = {}) => renderToStaticMarkup(createElement(VisualCard, { visual: { ...buildAuthorVisual(item), rows: data.rows }, dataMessage: data.message, provenance: data.provenance, ...props }));
const controller = () => new AbortController();

test('query provenance survives HTTP and author loading, with labels only for cache or aggregate results', async () => {
  const item = visual('kpi');
  for (const [provenance, label] of [
    [undefined, undefined], [{ source: 'live' }, undefined],
    [{ source: 'cache', cachedAt: '2026-10-30T00:00:00.000Z' }, 'Cached result'],
    [{ source: 'aggregate', aggregateName: '<regional sales>' }, 'Aggregate: &lt;regional sales&gt;'],
  ]) {
    const client = createApiClient('/', async () => Response.json({ columns: [{ name: 'revenue', type: 'number' }], rows: [{ revenue: 900 }], ...(provenance ? { provenance } : {}) }));
    const data = await loadAuthorRows(client, buildAuthorQuery(item), controller().signal);
    assert.deepEqual(data.provenance, provenance);
    const html = render(item, data);
    if (label) {
      assert.ok(html.includes(label));
      assert.doesNotMatch(render(item, data, { loading: true }), /query-provenance/);
    } else assert.doesNotMatch(html, /query-provenance|Cached result|Aggregate:/);
  }
});

test('malformed provenance cannot claim a cached or aggregate result', async () => {
  for (const provenance of [{ source: 'unknown' }, { source: 'aggregate' }, { source: 'aggregate', aggregateName: 4 }, { source: 'cache', cachedAt: 'yesterday' }]) {
    const client = createApiClient('/', async () => Response.json({ columns: [{ name: 'revenue', type: 'number' }], rows: [{ revenue: 900 }], provenance }));
    const data = await loadAuthorRows(client, buildAuthorQuery(visual('kpi')), controller().signal);
    assert.equal(data.rows, null);
    assert.match(data.message, /Invalid query result provenance/);
  }
});

test('assignments produce the query projection for all kinds, dates and multiple measures without the fixture East filter', () => {
  for (const kind of ['bar', 'line', 'pie', 'kpi', 'table']) {
    const item = visual(kind);
    assert.deepEqual(buildAuthorQuery(item), {
      dimensions: kind === 'kpi' ? [] : [{ fieldId: item.dimension, columnName: item.dimension, ...(kind === 'line' ? { granularity: 'MONTH' } : {}) }],
      measures: [{ fieldId: 'revenue', columnName: 'revenue', aggregation: 'SUM' }], filters: [],
    });
  }
  assert.deepEqual(buildAuthorQuery({ ...visual('bar'), measures: ['revenue', 'profit'] }).measures,
    ['revenue', 'profit'].map(name => ({ fieldId: name, columnName: name, aggregation: 'SUM' })));
  assert.equal(buildAuthorQuery({ ...visual('bar'), measures: [] }), null);
  assert.equal(buildAuthorQuery({ ...visual('bar'), dimension: null }), null);
});

test('live Author POST uses the definition client base, JSON headers and cancellation, then renders returned rows', async () => {
  const item = { ...visual('table'), measures: ['revenue', 'profit'] };
  const request = buildAuthorQuery(item);
  const abort = controller();
  const calls = [];
  const client = createApiClient('http://localhost:3000/prefix///', async (...args) => {
    calls.push(args);
    return Response.json({ columns: [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }, { name: 'profit', type: 'number' }],
      rows: [{ region: 'East', revenue: 500, profit: 65 }, { region: 'West', revenue: 400, profit: 70 }] });
  });
  const data = await loadAuthorRows(client, request, abort.signal);
  assert.deepEqual(calls, [['http://localhost:3000/prefix/api/datasets/sales/query', {
    method: 'POST', signal: abort.signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  }]]);
  const html = render(item, data);
  assert.match(html, /<td>East<\/td><td>500<\/td><td>65<\/td>/);
  assert.match(html, /<td>West<\/td><td>400<\/td><td>70<\/td>/);
  assert.doesNotMatch(html, /Unable to load data/);
});

test('default, blank, origin and root API bases route queries through the same mount as definitions', async () => {
  for (const [base, expected] of [[undefined, '/api/api'], [' ', '/api/api'], ['/', '/api'], ['http://localhost:3000/', 'http://localhost:3000/api']]) {
    let url;
    const client = createApiClient(base, async input => { url = input; return Response.json({ columns: [{ name: 'revenue', type: 'number' }], rows: [{ revenue: 900 }] }); });
    await client.queryDataset('sales', buildAuthorQuery(visual('kpi')));
    assert.equal(url, `${expected}/datasets/sales/query`);
  }
});

test('MONTH results bind the engine month alias; zero rows show No results', async () => {
  const item = visual('line');
  for (const rows of [[{ month: '2025-01', revenue: 600 }, { month: '2025-03', revenue: 50 }], []]) {
    const client = createApiClient('/', async () => Response.json({ columns: [{ name: 'month', type: 'string' }, { name: 'revenue', type: 'number' }], rows }));
    const data = await loadAuthorRows(client, buildAuthorQuery(item), controller().signal);
    const compiled = compileVisual({ ...buildAuthorVisual(item), rows: data.rows });
    assert.equal(compiled.state, rows.length ? 'ready' : 'empty');
    assert.deepEqual(compiled.table.rows, rows.map(row => [row.month, row.revenue]));
    if (!rows.length) assert.match(render(item, data), /No results/);
  }
});

test('422 preserves engine details and shows recovery guidance with the engine message, never fixture rows', async () => {
  const item = visual('bar');
  const error = { errorCode: 'UNSUPPORTED_FEATURE', message: 'Unsupported aggregation <MEDIAN>', path: '$.analysis.Definition.Sheets' };
  const client = createApiClient('/', async () => Response.json(error, { status: 422 }));
  const request = buildAuthorQuery(item);
  await assert.rejects(client.queryDataset('sales', request), e => e instanceof QueryError && e.status === 422 && e.message === error.message && e.errorCode === error.errorCode && e.path === error.path);
  const data = await loadAuthorRows(client, request, controller().signal);
  assert.deepEqual(data, { rows: null, message: error.message });
  const html = render(item, data);
  assert.match(html, /Unable to load data/);
  assert.match(html, /Unsupported aggregation &lt;MEDIAN&gt;/);
  assert.match(html, /check the selected fields and data access, then retry/);
  assert.doesNotMatch(html, /View data|No matching precomputed|<MEDIAN>/);
});

test('network, HTTP and malformed successes leave live data unavailable', async () => {
  const item = visual('kpi');
  for (const fetcher of [
    async () => { throw new Error('Offline'); },
    async () => Response.json({ Message: 'No binding' }, { status: 404 }),
    async () => new Response('Bad gateway', { status: 502 }),
    async () => Response.json({ columns: [], rows: [] }),
    async () => Response.json({ columns: [{ name: 'revenue', type: 'number' }], rows: [{ revenue: 'wrong type' }] }),
    async () => Response.json({ columns: [{ name: 'revenue', type: 'number' }], rows: [{}] }),
  ]) {
    const data = await loadAuthorRows(createApiClient('/', fetcher), buildAuthorQuery(item), controller().signal);
    assert.equal(data.rows, null);
    assert.ok(data.message);
    assert.match(render(item, data), /Unable to load data/);
    assert.doesNotMatch(render(item, data), /View data/);
  }
});

test('cancelled requests cannot publish success or errors even when the transport ignores abort', async () => {
  for (const fails of [false, true]) {
    let finish;
    const client = { queryDataset: () => new Promise((resolve, reject) => { finish = () => fails ? reject(new Error('late error')) : resolve({ columns: [], rows: [{ revenue: 999 }] }); }) };
    const abort = controller();
    const pending = loadAuthorRows(client, buildAuthorQuery(visual('kpi')), abort.signal);
    abort.abort(); finish();
    await assert.rejects(pending, { name: 'AbortError' });
  }
});

test('live canvas initially shows loading without fixture data; offline Author retains its disclosed fixture boundary', () => {
  const client = { queryDataset() { throw new Error('SSR must not query'); } };
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: draft('bar'), dispatch() {}, client }));
  assert.match(html, /Loading data/);
  assert.doesNotMatch(html, /View data|No matching precomputed/);
  const live = renderToStaticMarkup(createElement(Author, { client }));
  assert.match(live, /Live local sales data/);
  assert.doesNotMatch(live, /region = East/);
  const offline = renderToStaticMarkup(createElement(Author));
  assert.match(offline, /Offline demo/);
  assert.match(offline, /region = East/);
  assert.match(offline, /No live queries run/);
});

test('reopened prepared queries retry only the busy gate, with a finite retry budget', async t => {
  const { ApiError } = await import('../build/test/api-client.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const busy = new ApiError('BLAZE_BUSY: another read is finishing', 409);
  const client = { dataset: { id: 'prepared-reopen' }, async queryDataset(id) {
    assert.equal(id, 'prepared-reopen'); calls++;
    if (calls < 3) throw busy;
    return { rows: [{ region: 'North', revenue: 6 }] };
  } };
  const pending = loadAuthorRows(client, buildAuthorQuery(visual('kpi')), controller().signal);
  await new Promise(setImmediate); t.mock.timers.tick(250);
  await new Promise(setImmediate); t.mock.timers.tick(500);
  assert.deepEqual(await pending, { rows: [{ region: 'North', revenue: 6 }] }); assert.equal(calls, 3);
  calls = 0;
  client.queryDataset = async () => { calls++; throw busy; };
  const exhausted = loadAuthorRows(client, buildAuthorQuery(visual('kpi')), controller().signal);
  for (const delay of [250, 500, 1000]) { await new Promise(setImmediate); t.mock.timers.tick(delay); }
  assert.match((await exhausted).message, /BLAZE_BUSY/); assert.equal(calls, 4);
  calls = 0;
  client.queryDataset = async () => { calls++; throw new ApiError('SECURITY_DENIED', 403); };
  assert.match((await loadAuthorRows(client, buildAuthorQuery(visual('kpi')), controller().signal)).message, /SECURITY_DENIED/);
  assert.equal(calls, 1);
});
test('malformed and mixed insight configurations fail closed with zero query calls (issue #267)', async () => {
  const base = { ...visual('insight'), dimension: 'region', measures: ['revenue'] };
  const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'sales_data' } } });
  const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'sales_data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
  // Structural failures: draft admission and query construction both reject.
  const structural = [
    ['mixed movers collection', { computations: [{ topBottomMovers: { computationId: 'm', type: 'TOP' } }, { totalAggregation: { computationId: 't' } }] }],
    ['unknown computation variant', { computations: [{ futureComputation: { computationId: 'x' } }] }],
    ['unsupported computation property', { computations: [{ totalAggregation: { computationId: 't', futureOption: 1 } }] }],
    ['duplicate computation IDs', { computations: [{ totalAggregation: { computationId: 't' } }, { totalAggregation: { computationId: 't' } }] }],
    ['custom narrative', { customNarrative: { narrative: 'Total: ${total}' } }],
    ['movers without a type', { computations: [{ topBottomMovers: { computationId: 'm' } }] }],
    ['forecast periods out of range', { computations: [{ forecast: { computationId: 'f', forecastProperties: { periodsForward: 101 } } }] }],
  ];
  // Binding failures: the configuration is structurally sound, so a draft may
  // hold it, but no query may be issued against this visual's wells.
  const binding = [
    ['forecast on a non-date dimension', { computations: [{ forecast: { computationId: 'f' } }] }],
    ['metric comparison with one measure', { computations: [{ metricComparison: { computationId: 'c' } }] }],
    ['metric comparison binding the same measure twice', { computations: [{ metricComparison: { computationId: 'c', fromValue: measure('revenue'), targetValue: measure('revenue') } }] }, { measures: ['revenue', 'profit'] }],
  ];
  const restored = (configuration, overrides = {}) => { const d = structuredClone(draft('insight')); Object.assign(activeSheet(d).visuals[0], { insightConfiguration: configuration, ...overrides }); return d; };
  for (const [label, configuration, overrides] of [...structural, ...binding]) {
    const item = { ...base, ...overrides, insightConfiguration: configuration };
    let calls = 0;
    const client = { async queryDataset() { calls++; return { rows: [] }; } };
    const request = buildAuthorQuery(item);
    assert.equal(request, null, label);
    // LiveAuthorVisual's load gate: without a request, no query is issued.
    if (request) await loadAuthorRows(client, request, controller().signal);
    assert.equal(calls, 0, label);
  }
  for (const [label, configuration, overrides] of structural) assert.throws(() => validateDraft(restored(configuration, overrides)), /Invalid or unsupported author draft/, label);
  for (const [label, configuration, overrides] of binding) assert.doesNotThrow(() => validateDraft(restored(configuration, overrides)), label);
  // Valid configurations still query: an unbound total, a bound movers
  // collection over (category, time), and a measure-free uniqueValues.
  const total = { ...base, insightConfiguration: { computations: [{ totalAggregation: { computationId: 't' } }] } };
  let calls = 0;
  const client = { async queryDataset() { calls++; return { rows: [{ region: 'East', revenue: 5 }] }; } };
  const data = await loadAuthorRows(client, buildAuthorQuery(total), controller().signal);
  assert.equal(calls, 1); assert.deepEqual(data.rows, [{ region: 'East', revenue: 5 }]);
  const movers = { ...base, insightConfiguration: { computations: [{ topBottomMovers: { computationId: 'm', type: 'TOP', category: dim('region'),
    time: { dateDimensionField: { fieldId: 'order_date', column: { columnName: 'order_date', dataSetIdentifier: 'sales_data' }, dateGranularity: 'MONTH' } }, value: measure('revenue') } }] } };
  assert.deepEqual(buildAuthorQuery(movers).dimensions.map(d => d.fieldId), ['region', 'order_date']);
  const uv = { ...base, measures: [], insightConfiguration: { computations: [{ uniqueValues: { computationId: 'u', category: dim('region') } }] } };
  assert.ok(buildAuthorQuery(uv));
});

test('cancelling a pending reopen retry prevents any later query', async t => {
  const { ApiError } = await import('../build/test/api-client.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const abort = controller(); let calls = 0;
  const pending = loadAuthorRows({ async queryDataset() { calls++; throw new ApiError('BLAZE_BUSY: previous read', 409); } }, buildAuthorQuery(visual('kpi')), abort.signal);
  await new Promise(setImmediate);
  abort.abort(); await assert.rejects(pending, { name: 'AbortError' });
  t.mock.timers.tick(5000); assert.equal(calls, 1);
});

const insightDimension = (name, date = false) => ({ [date ? 'dateDimensionField' : 'categoricalDimensionField']: {
  fieldId: name, column: { columnName: name, dataSetIdentifier: 'sales_data' }, ...(date ? { dateGranularity: 'MONTH' } : {}),
} });
const insightMeasure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'sales_data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const insightSlots = {
  totalAggregation: ['value'], maximumMinimum: ['time', 'value'], topBottomRanked: ['category', 'value'],
  growthRate: ['time', 'value'], periodOverPeriod: ['time', 'value'], metricComparison: ['time', 'fromValue', 'targetValue'],
  forecast: ['time', 'value'], periodToDate: ['time', 'value'], uniqueValues: ['category'],
  topBottomMovers: ['category', 'time', 'value'], anomaly: ['time', 'value'],
};
for (const [kind, slots] of Object.entries(insightSlots)) {
  test(`${kind} rejects malformed nested bindings before author queries (issue #297)`, async () => {
    const bindings = { category: insightDimension('region'), time: insightDimension('order_date', true),
      value: insightMeasure('revenue'), fromValue: insightMeasure('revenue'), targetValue: insightMeasure('profit') };
    const options = kind === 'maximumMinimum' ? { type: 'MAXIMUM' } : ['topBottomRanked', 'topBottomMovers'].includes(kind) ? { type: 'TOP' } : {};
    const base = { ...visual('insight'), dimension: slots.includes('category') || kind === 'totalAggregation' ? 'region' : 'order_date',
      measures: kind === 'uniqueValues' ? [] : kind === 'metricComparison' ? ['revenue', 'profit'] : ['revenue'],
      insightConfiguration: { computations: [{ [kind]: { computationId: 'c', ...options, ...Object.fromEntries(slots.map(slot => [slot, bindings[slot]])) } }] } };
    const request = buildAuthorQuery(base);
    assert.ok(request, `${kind}: valid control must query`);
    const dimensions = request.dimensions.map(d => ({ id: d.fieldId, column: d.columnName, dataSet: 'sales_data', ...(d.granularity ? { dateGranularity: d.granularity } : {}) }));
    const measures = base.measures.map(name => ({ id: name, column: name, dataSet: 'sales_data' }));
    assert.doesNotThrow(() => normalizeInsight(base.insightConfiguration, dimensions, measures));
    let calls = 0;
    const client = { async queryDataset() { calls++; return { rows: [] }; } };
    for (const slot of slots) {
      const measure = !['category', 'time'].includes(slot);
      const mutations = [
        ['null binding', () => null], ['array binding', () => []], ['primitive binding', () => 'region'], ['empty binding', () => ({})],
        ['unknown variant', () => ({ unsupportedDimensionField: {} })],
        ['multiple variants', raw => ({ ...raw, unsupportedDimensionField: {} })],
        ['wrong slot variant', () => measure ? insightDimension('revenue') : insightMeasure('region')],
        ['null field', raw => ({ [Object.keys(raw)[0]]: null })],
        ['array field', raw => ({ [Object.keys(raw)[0]]: [] })],
        ['primitive field', raw => ({ [Object.keys(raw)[0]]: 1 })],
        ['extra field property', (raw, field) => { field.unsupported = true; return raw; }],
        ['missing fieldId', (raw, field) => { delete field.fieldId; return raw; }],
        ['non-string fieldId', (raw, field) => { field.fieldId = 1; return raw; }],
        ['missing column', (raw, field) => { delete field.column; return raw; }],
        ['null column', (raw, field) => { field.column = null; return raw; }],
        ['array column', (raw, field) => { field.column = []; return raw; }],
        ['extra column property', (raw, field) => { field.column.unsupported = true; return raw; }],
        ['missing columnName', (raw, field) => { delete field.column.columnName; return raw; }],
        ['non-string columnName', (raw, field) => { field.column.columnName = 1; return raw; }],
        ['non-string dataset', (raw, field) => { field.column.dataSetIdentifier = 1; return raw; }],
      ];
      if (measure) mutations.push(
        ['missing aggregation', (raw, field) => { delete field.aggregationFunction; return raw; }],
        ...[null, [], 'SUM', {}, { simpleNumericalAggregation: 'AVERAGE' }, { simpleNumericalAggregation: 'COUNT' },
          { simpleNumericalAggregation: 'SUM', unsupported: true }, { percentileAggregation: { percentileValue: 50 } }]
          .map(aggregation => [`unsupported aggregation ${JSON.stringify(aggregation)}`, (raw, field) => { field.aggregationFunction = aggregation; return raw; }]),
        ['date grain on measure', (raw, field) => { field.dateGranularity = 'MONTH'; return raw; }],
      );
      else mutations.push(
        ['aggregation on dimension', (raw, field) => { field.aggregationFunction = { simpleNumericalAggregation: 'SUM' }; return raw; }],
        ['unsupported date grain', (raw, field) => { field.dateGranularity = 'WEEK'; return raw; }],
      );
      for (const [label, mutate] of mutations) {
        const item = structuredClone(base), raw = item.insightConfiguration.computations[0][kind][slot];
        item.insightConfiguration.computations[0][kind][slot] = mutate(raw, Object.values(raw)[0]);
        let directError;
        assert.throws(() => normalizeInsight(item.insightConfiguration, dimensions, measures), error => {
          directError = error; return /^INSIGHT_(FIELD_UNBOUND|CONFIGURATION_INVALID|CONFIGURATION_UNSUPPORTED)$/.test(error.code);
        }, `${slot}: ${label}`);
        const before = structuredClone(item), query = buildAuthorQuery(item);
        assert.equal(query, null, `${slot}: ${label} (${directError.code})`);
        if (query) await loadAuthorRows(client, query, controller().signal);
        assert.deepEqual(item, before, `${slot}: query validation must not mutate the visual`);
      }
    }
    assert.equal(calls, 0);
  });
}

test('valid imported insight bindings still follow changed author wells and preserve movers time (issue #297)', () => {
  const oldDimension = (name, date = false) => {
    const raw = insightDimension(name, date), field = Object.values(raw)[0];
    field.fieldId = `imported-${name}`; field.column.dataSetIdentifier = 'old-data';
    if (date) field.dateGranularity = 'DAY';
    return raw;
  };
  const oldMeasure = name => { const raw = insightMeasure(name); raw.numericalMeasureField.fieldId = `imported-${name}`; raw.numericalMeasureField.column.dataSetIdentifier = 'old-data'; return raw; };
  const cases = [
    ['uniqueValues', { category: oldDimension('old-category') }, 'category', [], ['category']],
    ['forecast', { time: oldDimension('old-date', true), value: oldMeasure('old-value'), forecastProperties: { periodsForward: 5 } }, 'order_date', ['profit'], ['order_date']],
    ['metricComparison', { time: oldDimension('old-date', true), fromValue: oldMeasure('old-from'), targetValue: oldMeasure('old-target') }, 'order_date', ['profit', 'revenue'], ['order_date']],
    ['topBottomMovers', { type: 'BOTTOM', category: oldDimension('old-category'), time: oldDimension('order_date', true), value: oldMeasure('old-value'), moverSize: 2, sortOrder: 'ABSOLUTE_DIFFERENCE' }, 'category', ['profit'], ['category', 'order_date']],
  ];
  for (const [kind, fields, dimension, measures, expectedDimensions] of cases) {
    const item = { ...visual('insight'), dimension, measures, dateGrain: 'MONTH', insightConfiguration: { computations: [{ [kind]: { computationId: 'c', name: 'Imported computation', ...fields } }] } };
    const before = structuredClone(item), query = buildAuthorQuery(item);
    assert.ok(query, kind);
    assert.deepEqual(query.dimensions.map(d => d.columnName), expectedDimensions);
    assert.ok(query.dimensions.filter(d => d.columnName === 'order_date').every(d => d.granularity === 'MONTH'));
    if (measures.length) assert.deepEqual(query.measures.map(m => m.columnName), measures);
    const compiled = compileVisual({ source: 'bundle', definition: serializeVisual(item), rows: null, path: '$', bindings: {} });
    assert.deepEqual(compiled.model.dimensions.map(d => d.column), expectedDimensions);
    const requests = normalizeInsight(compiled.model.insightConfiguration, compiled.model.dimensions, compiled.model.measures);
    assert.equal(requests[0].kind, kind); assert.equal(requests[0].measure, 0);
    if (kind === 'metricComparison') assert.equal(requests[0].target, 1);
    if (kind === 'forecast') assert.equal(requests[0].forecast.periodsForward, 5);
    if (kind === 'topBottomMovers') assert.deepEqual(requests[0], { kind, id: 'c', measure: 0, type: 'BOTTOM', size: 2, sortOrder: 'ABSOLUTE_DIFFERENCE' });
    assert.deepEqual(item, before);
  }
});
