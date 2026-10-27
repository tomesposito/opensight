import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 119: hover feedback for the data dialogs'
// plain labels (.data-dialog label — "Dataset name" in DatasetDetail's
// Duplicate dialog, "Occurrence (minutes)" in DatasetRefresh's schedule
// dialog, "Configured source" and the connector config labels in
// CreateDatasetDialog/DataSources, and the replace panel's label in
// ManageDataDialog). The resting rule (.data-dialog label
// { display: block; }) plus the block field with its margin-top make
// each label a visible surface (text line, field below), but the
// labels had zero hover feedback: slices 30/48 hovered the dialogs'
// buttons and fields, and every other label :hover rule in the cascade
// is scoped elsewhere (author labels, calculation/analysis-file
// dialogs, prep labels, connector/sign-in/collection labels, admin
// labels, embed labels). A CSSOM probe with all five real stylesheets
// (1,385 rules) in the real ancestor context (dialog.data-dialog >
// form > .data-dialog-body > label) confirmed zero matching :hover
// rules for the labels and a transparent rest, while the fields inside
// them matched the data-dialog field hover. The labels now take
// #eaf3f7, the data surface's established hover tint (the dialogs' own
// field and button hovers, slices 30/48, and the data-page hovers), so
// no new colour is introduced — and because the label and the field
// inside it take the same tint, hovering either reads as one surface,
// not two steps. Background only, so resting geometry is identical and
// there is no animation; the data dialogs are fixed-light surfaces, so
// no dark variant. Connector tiles (label.data-connector-tile) already
// hover #eaf3f7 under their own rules, so they are unchanged in effect.
const dataCss = styles['data-section.css'];

const labelRule = dataCss.match(/^\.data-dialog label:hover\s*\{([^}]*)\}/m);

test('the data-dialog label hover rule exists and uses the established hover tint', () => {
  assert.ok(labelRule, 'expected the data-dialog label :hover rule');
  assert.match(labelRule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the data-dialog field and button hovers, so no new colour is introduced', () => {
  assert.ok(dataCss.match(/\.data-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\)[^{]*\{[^}]*background:\s*#eaf3f7/), 'the data-dialog field hover must remain #eaf3f7');
  assert.ok(dataCss.match(/\.data-dialog button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-dialog button hover must remain #eaf3f7');
  assert.ok(dataCss.match(/\.data-page select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page select hover must remain #eaf3f7');
});

test('the data-dialog label hover rule is paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(labelRule, 'expected the data-dialog label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting data-dialog label rules are preserved', () => {
  assert.ok(dataCss.match(/\.data-dialog label\s*\{[^}]*display:\s*block/), 'the resting data-dialog label rule must remain');
  assert.ok(dataCss.match(/\.data-dialog label > input:not\(\[type=radio\]\)\s*\{[^}]*display:\s*block[^}]*margin-top:\s*4px/), 'the resting block-field rule must remain');
  assert.ok(dataCss.match(/\.data-dialog \.data-connector-tile\s*\{[^}]*display:\s*flex/), 'the connector tile label resting rule must remain');
});

defineHoverCases('data-dialog-label hover', {
  html: `<dialog class="data-dialog" open><form><div class="data-dialog-body">`
      + `<label id="nameLabel">Dataset name<input id="nameInput" value="Sales copy"/></label>`
      + `<label id="sourceLabel">Configured source<select id="sourceSelect"><option>PostgreSQL</option></select></label>`
      + `<div class="data-inline-panel"><label id="panelLabel">Replace <strong>Sales</strong> with <select id="panelSelect"><option>Other</option></select></label></div>`
      + `<label class="data-connector-tile" id="tileLabel"><input id="tileRadio" type="radio" name="c"/>PostgreSQL</label>`
      + `</div></form></dialog>`
      + `<label id="outsideLabel">Outside<input id="outsideInput"/></label>`,
  cases: [
    {
      target: '#nameLabel',
      rule: '.data-dialog label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel'],
    },
    {
      target: '#sourceLabel',
      rule: '.data-dialog label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#panelLabel',
      rule: '.data-dialog label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#tileLabel',
      rule: '.data-dialog label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
