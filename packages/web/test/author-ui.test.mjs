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

test('empty canvas exposes all visual types and typed fields with assignment disabled', () => {
  const html = renderCanvas(emptyDraft());
  assert.match(html, /Your canvas is ready/);
  for (const kind of ['bar', 'line', 'pie', 'kpi', 'table']) assert.match(html, new RegExp(`value="${kind}"`));
  for (const field of ['order_id', 'order_date', 'region', 'category', 'revenue', 'profit']) {
    assert.match(html, new RegExp(`disabled="" aria-label="Assign ${field}"`));
  }
  for (const label of ['Dimensions', 'Measures', 'INTEGER', 'DATETIME', 'STRING', 'DECIMAL']) assert.ok(html.includes(label));
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

test('shared VisualCard shows ready, unavailable, empty and compiler error states', () => {
  const preview = buildAuthorPreview(activeSheet(add()).visuals[0]);
  assert.match(renderCard(preview), /View data · 1 row/);
  assert.match(renderCard({ ...preview, rows: null }), /Data unavailable/);
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
  assert.match(html, /The saved draft could not be restored/);
  assert.match(html, /region = East/);
  assert.match(html, /No live queries run/);
  assert.match(html, /disabled="" aria-describedby="export-help">Export JSON/);
  assert.match(html, /sample rows and the fixed East preview filter are not included/);
});
