import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 48: hover feedback for the data dialogs' fields.
// A behavioral hover probe (real mouse + computed-style delta, replica
// carrying the real data-section.css, markup mirroring CreateDatasetDialog
// and DataSectionUI) measured the create-dataset dialog's search input
// (260x28), a config-form text input and a select white -> white on hover,
// while the dialog's plain buttons tinted (slices 16/30) and its primary
// button darkened. Slices 21/27 gave the .data-page select and search input
// the data surface's menu-item tint (#e8eefb) but never the .data-dialog
// fields. They now take the same tint. Native radio/checkbox/file inputs
// keep their OS rendering (the slice-44 exclusion pattern). Background
// only, so resting geometry is identical; disabled fields keep their flat
// state. Static (no animation), so no reduced-motion variant is needed.
const css = styles['data-section.css'];

const fieldRule = css.match(/\.data-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\), \.data-dialog select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the data-dialog field hover rule exists and uses the menu tint', () => {
  assert.ok(fieldRule, 'expected the grouped .data-dialog input/select hover rule');
  assert.match(fieldRule[1], /background:\s*#e8eefb/);
});

test('the field hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(fieldRule, 'expected the data-dialog field hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(fieldRule[1]), 'field hover must change background only');
});

test('the resting dialog-field rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.data-page input, \.data-dialog input, \.data-page select, \.data-dialog select\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the grouped resting field rule naming .data-dialog');
  assert.match(resting[1], /padding:\s*4px 8px/);
  assert.match(resting[1], /border:\s*1px solid #9eb0ba/);
  assert.match(resting[1], /background:\s*white/);
});

test('the dialog field hover rule coexists with the page field rules', () => {
  assert.ok(css.match(/\.data-page select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-page select hover rule (slice 21) must still be present');
  assert.ok(css.match(/\.data-page input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-page search-input hover rule (slice 27) must still be present');
  assert.ok(css.match(/\.data-dialog button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-dialog button hover rule (slice 30) must still be present');
});

defineHoverCases('data-dialog-field hover', {
  html: `<dialog class="data-dialog" open><div class="data-dialog-body">
      <div class="data-dialog-tools"><input id="search" type="search" placeholder="Search data sources"></div>
      <label>Connection name<input id="name" type="text" value="x"></label>
      <label>Region<select id="region"><option>us-east-1</option></select></label>
      <label class="data-connector-tile"><input id="tile-radio" type="radio" name="c"></label>
    </div></dialog>`,
  cases: [
    {
      target: '#search',
      rule: '.data-dialog input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"]), .data-dialog select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      excluded: ['#tile-radio'],
    },
    {
      target: '#name',
      rule: '.data-dialog input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"]), .data-dialog select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
    },
    {
      target: '#region',
      rule: '.data-dialog input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"]), .data-dialog select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
    },
  ],
});
