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
