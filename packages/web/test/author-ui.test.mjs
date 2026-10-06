import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Author, AuthorCanvas } from '../build/test/Author.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';
import { buildAuthorPreview } from '../build/test/author-preview.js';

const add = (kind = 'bar') => authorReducer(emptyDraft(), { type: 'add', kind });
const renderCanvas = draft => renderToStaticMarkup(createElement(AuthorCanvas, { draft, dispatch() {} }));
const renderCard = visual => renderToStaticMarkup(createElement(VisualCard, { visual }));

test('empty canvas exposes all visual types and enables assignable typed fields', () => {
  const html = renderCanvas(emptyDraft());
  assert.match(html, /Your canvas is ready/);
  for (const kind of ['bar', 'line', 'pie', 'kpi', 'table']) assert.match(html, new RegExp(`value="${kind}"`));
  for (const field of ['order_id', 'order_date', 'region', 'category', 'revenue', 'profit']) {
    assert.match(html, new RegExp(`aria-label="Assign ${field}"`));
    assert.doesNotMatch(html, new RegExp(`disabled="" aria-label="Assign ${field}"`));
  }
  for (const label of ['Geography', 'Metadata', 'Sales', 'INTEGER', 'DATETIME', 'STRING', 'DECIMAL']) assert.ok(html.includes(label));
});

test('empty and newly emptied canvases retain ordered, labeled, keyboard-native field wells', () => {
  const populated = add();
  const emptied = authorReducer(populated, { type: 'remove', id: activeSheet(populated).selectedId });
  for (const draft of [emptyDraft(), emptied]) {
    const html = renderCanvas(draft);
    assert.match(html, /<h3>Field wells<\/h3>/);
    assert.deepEqual([...html.matchAll(/<legend>(ROWS|COLUMNS|VALUES)<\/legend>/g)].map(m => m[1]), ['ROWS', 'COLUMNS', 'VALUES']);
    for (const name of ['ROWS', 'COLUMNS', 'VALUES']) {
      assert.match(html, new RegExp(`<button type="button" class="well-placeholder" aria-label="Select ${name} well" aria-pressed="${name === 'ROWS'}">Add a ${name === 'VALUES' ? 'measure' : 'dimension'}</button>`));
    }
    assert.doesNotMatch(html, /Choose a visual type and select ADD/);
  }
});

for (const [kind, well] of [['bar', 'Category'], ['line', 'X-axis'], ['pie', 'Category'], ['kpi', null], ['table', 'Group-by']]) {
  test(`${kind} configuration exposes its wells, removable assignments and move boundaries`, () => {
    const html = renderCanvas(add(kind));
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /<legend>Values/);
    assert.match(html, /aria-label="Remove revenue from Values"/);
    assert.match(html, /disabled="" aria-label="Move Visual 1 up"/);
    assert.match(html, /disabled="" aria-label="Move Visual 1 down"/);
    if (well) assert.ok(html.includes(`<legend>${well}`));
    else {
      assert.doesNotMatch(html, /Assign dimension/);
      assert.match(html, /disabled="" aria-label="Assign region"/);
    }
    assert.equal(html.includes('Donut</label>'), kind === 'pie');
  });
}

test('only the selected card exposes configuration and titles are escaped', () => {
  let draft = authorReducer(add(), { type: 'add', kind: 'line' });
  draft = authorReducer(draft, { type: 'title', title: '<img src=x onerror=alert(1)>' });
  const html = renderCanvas(draft);
  assert.doesNotMatch(html, /id="configure-visual-1"/);
  assert.match(html, /id="configure-visual-2"/);
  assert.equal((html.match(/class="visual-config"/g) ?? []).length, 1);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
});

test('Data hints name the actual dimension well, including specialized visual types', () => {
  for (const [kind, label] of [['bar', 'Category'], ['line', 'X-axis'], ['table', 'Group-by'], ['pivot', 'Rows'], ['radar', 'Category'], ['pointMap', 'Latitude'], ['box', 'Group / sample dimensions'], ['kpi', 'unavailable for this visual']]) {
    const html = renderCanvas(add(kind));
    assert.ok(html.includes(`Dimensions: ${label}. Measures: VALUES.`), kind);
  }
});

test('shared VisualCard shows ready, unavailable, empty and compiler error states', () => {
  const preview = buildAuthorPreview(activeSheet(add()).visuals[0]);
  assert.match(renderCard(preview), /View data · 1 row/);
  assert.match(renderCard({ ...preview, rows: null }), /Needs data/);
  assert.match(renderCard({ ...preview, rows: [] }), /No results/);
  const incomplete = authorReducer(add(), { type: 'unassign', field: 'revenue' });
  const error = renderCard(buildAuthorPreview(activeSheet(incomplete).visuals[0]));
  assert.match(error, /role="alert"/);
  assert.match(error, /Unable to render/);
  assert.match(error, /expected supported number of measures/);
});

test('shared table preview renders the validated cells as semantic HTML', () => {
  const html = renderCard(buildAuthorPreview(activeSheet(add('table')).visuals[0]));
  assert.match(html, /<th scope="col">region<\/th>/);
  assert.match(html, /<td>East<\/td><td>500<\/td>/);
  assert.doesNotMatch(html, /role="img"/);
});

test('Author discloses fixture boundaries and recovers when browser storage is unavailable', () => {
  const html = renderToStaticMarkup(createElement(Author));
  assert.match(html, /Browser storage is unavailable outside a browser/);
  assert.match(html, /Export JSON to keep your work/);
  assert.match(html, /region = East/);
  assert.match(html, /No live queries run/);
  assert.doesNotMatch(html, /disabled="" aria-describedby="export-help">Export JSON/);
  assert.match(html, /aria-describedby="export-help">Export JSON/);
  assert.match(html, /sample rows and the fixed East preview filter are not included/);
});


test('Issue #35: each export action has exactly one home in the File menu', () => {
  const html = renderToStaticMarkup(createElement(Author));
  const fileMenu = html.match(/<summary>File<\/summary>([\s\S]*?)<\/details>/)[1];
  for (const label of ['Export JSON', 'Download .qs']) {
    assert.equal(html.split(`>${label}</button>`).length - 1, 1, label);
    assert.ok(fileMenu.includes(`aria-describedby="export-help">${label}</button>`));
  }
});
