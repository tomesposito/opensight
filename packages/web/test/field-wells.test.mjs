import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthorCanvas } from '../build/test/Author.js';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';

const edit = (draft, ...actions) => actions.reduce(authorReducer, draft);
const render = draft => renderToStaticMarkup(createElement(AuthorCanvas, { draft, dispatch() {} }));
const wells = draft => render(draft).match(/<div class="field-wells">([\s\S]*?)<\/fieldset><\/div>/)[1];

test('measure placeholder is replaced by a typed pill and restored after removing the last measure', () => {
  let draft = edit(emptyDraft(), { type: 'assign-with-no-selection', field: 'order_date' });
  assert.match(wells(draft), />Add a measure<\/button>/);
  assert.match(wells(draft), /aria-label="Date and time"[^>]*><svg/);
  draft = edit(draft, { type: 'assign', field: 'revenue', well: 'values' });
  assert.doesNotMatch(wells(draft), />Add a measure<\/button>/);
  assert.match(wells(draft), /aria-label="Decimal"[^>]*>#<\/span>/);
  assert.match(wells(draft), /SUM\(revenue\)/);
  draft = edit(draft, { type: 'assign', field: 'profit', well: 'values' }, { type: 'unassign', field: 'revenue', well: 'values' });
  assert.doesNotMatch(wells(draft), />Add a measure<\/button>/);
  draft = edit(draft, { type: 'unassign', field: 'profit', well: 'values' });
  assert.match(wells(draft), />Add a measure<\/button>/);
  assert.equal(activeSheet(draft).visuals[0].dimension, 'order_date');
});

test('Data panel retains dataset name and truthful badge beside search and calculated-field action', () => {
  const html = render(emptyDraft());
  assert.match(html, /class="dataset-name">Local sales dataset/);
  assert.match(html, /class="dataset-badge"[^>]*>BLAZE/);
  assert.match(html, /placeholder="Search fields"/);
  assert.match(html, />\+ Calculated field<\/button>/);
});

for (const { kind, label } of (await import('../build/test/authoring.js')).VISUAL_TYPES) {
  test(`fresh ${kind} keeps the centered #55 guidance without seeded fields`, () => {
    const draft = edit(emptyDraft(), { type: 'add', kind, empty: true });
    const visual = activeSheet(draft).visuals[0];
    assert.equal(visual.dimension, null);
    for (const key of ['measures', 'rows', 'columns']) assert.deepEqual(visual[key], []);
    const html = render(draft);
    const title = kind === 'bar' || kind === 'line' ? `${label} chart` : kind === 'pie' ? 'Pie chart' : kind === 'pivot' ? 'Pivot table' : label;
    assert.ok(html.includes(`<div class="author-visual-empty" role="status"><h3>${title}</h3><p>Add 1 or more fields to build a visual.</p></div>`));
    assert.doesNotMatch(html, /Unable to render|visual-skeleton|class="chart"/);
    assert.match(wells(draft), />Add a measure<\/button>/);
    if (kind === 'bar' || kind === 'pie') assert.deepEqual([...wells(draft).matchAll(/<legend>([^<]+)<\/legend>/g)].map(m => m[1]), ['GROUP/COLOR', 'VALUE', 'SMALL MULTIPLES']);
  });
}

const { authorVisualProblem, parseDraft, validateDraft, serializeDraft, serializeVisual } = await import('../build/test/authoring.js');
const { buildAuthorQuery } = await import('../build/test/author-query.js');
const { exportBundle } = await import('../build/test/bundle-authoring.js');

test('Small multiples assignments persist, refuse preview/export, and remove independently of Group/Color', () => {
  const original = edit(emptyDraft(), { type: 'add', kind: 'pie' });
  let draft = edit(original, { type: 'assign', well: 'smallMultiples', field: 'category' });
  let visual = activeSheet(draft).visuals[0];
  assert.equal(activeSheet(original).visuals[0].smallMultiples, undefined);
  assert.deepEqual(visual.smallMultiples, ['category']);
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  assert.match(authorVisualProblem(visual), /^SMALL_MULTIPLES_UNSUPPORTED:/);
  assert.equal(buildAuthorQuery(visual), null);
  assert.throws(() => serializeDraft(draft), /SMALL_MULTIPLES_UNSUPPORTED/);
  assert.throws(() => exportBundle(draft), /SMALL_MULTIPLES_UNSUPPORTED/);
  assert.match(render(draft), /Remove category from Small multiples/);
  assert.doesNotMatch(render(draft), /class="chart"|Add 1 or more fields/);
  const exported = serializeVisual(visual).pieChartVisual.chartConfiguration.fieldWells.pieChartAggregatedFieldWells;
  assert.equal(exported.smallMultiples[0].categoricalDimensionField.column.columnName, 'category');
  draft = edit(draft, { type: 'unassign', well: 'smallMultiples', field: 'category' });
  visual = activeSheet(draft).visuals[0];
  assert.equal(visual.dimension, 'category');
  assert.deepEqual(visual.smallMultiples, []);
  assert.equal(authorVisualProblem(visual), undefined);
  assert.ok(buildAuthorQuery(visual));
  assert.doesNotThrow(() => serializeDraft(draft));
  assert.match(wells(draft), /Select SMALL MULTIPLES well/);
});

test('Small multiples reject invalid fields and preserve assignments across visual-type switches', () => {
  let draft = edit(emptyDraft(), { type: 'assign-with-no-selection', field: 'order_date', well: 'smallMultiples' });
  const before = activeSheet(draft).visuals[0];
  assert.equal(before.dimension, null);
  assert.deepEqual(before.smallMultiples, ['order_date']);
  for (const field of ['revenue', 'missing']) {
    assert.deepEqual(activeSheet(edit(draft, { type: 'assign', well: 'smallMultiples', field })).visuals[0], before);
  }
  for (const invalid of [['revenue'], ['missing'], ['region', 'region'], ['region', 'category'], 'region', null]) {
    const bad = structuredClone(draft); activeSheet(bad).visuals[0].smallMultiples = invalid;
    assert.throws(() => validateDraft(bad));
  }
  draft = edit(draft, { type: 'kind', kind: 'kpi' });
  assert.deepEqual(activeSheet(draft).visuals[0].smallMultiples, ['order_date']);
  assert.match(wells(draft), /Remove order_date from Small multiples/);
  assert.match(render(draft), /SMALL_MULTIPLES_UNSUPPORTED/);
  assert.doesNotThrow(() => parseDraft(JSON.stringify(draft)));
  draft = edit(draft, { type: 'unassign', field: 'order_date', well: 'smallMultiples' });
  assert.doesNotMatch(wells(draft), /SMALL MULTIPLES/);
});

test('empty uploaded-data visuals use no sample or uploaded fields until explicitly assigned', () => {
  const dataset = { id: 'synthetic', name: 'Synthetic upload', columns: [{ name: 'amount', type: 'DECIMAL' }, { name: 'day', type: 'DATETIME' }] };
  const draft = edit({ ...emptyDraft(), dataset }, { type: 'add', kind: 'bar', empty: true });
  assert.equal(activeSheet(draft).visuals[0].dimension, null);
  assert.deepEqual(activeSheet(draft).visuals[0].measures, []);
  assert.equal(draft.dataset, dataset);
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft, dispatch() {}, sourceProblem: 'Source data expired' }));
  assert.match(html, /Source data expired/);
  assert.doesNotMatch(html, /Add 1 or more fields/);
});
