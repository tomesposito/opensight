import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 91: hover feedback for the connector
// details fields (.connector-details input / select in
// DataSources.tsx's ConnectorDetails — the setup form in the
// standalone connector gallery, aside.connector-details inside
// section.data-sources in .app-shell > main). Every input/select
// :hover rule in the cascade is scoped elsewhere — the data-dialog
// field hovers cover these same fields only inside the
// create-dataset dialog, and the data-page / author / admin /
// collection scopes do not reach the standalone gallery — so these
// fields matched no :hover rule. A CSSOM probe with all five real
// stylesheets (1,343 rules) in the real ancestor context confirmed
// zero matching :hover rules and a white rest for both the text
// input and the select, while the gallery's search input (slice 90)
// and its submit (slice 66) do step. They now take the app surfaces'
// established field hover tint (#e8eefb — the data-dialog fields
// these mirror, slices 27/48, and the connector search input,
// slice 90), so no new colour is introduced. The file input keeps
// its flat state, following the data-dialog rule's own exclusion of
// file/radio/checkbox inputs. Background only, so resting geometry
// is identical and there is no animation. The gallery is a
// fixed-light app-shell surface, so no dark variant is added.
const css = styles['style.css'];
const dataCss = styles['data-section.css'];

const rule = css.match(/^\.connector-details input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\), \.connector-details select:hover:not\(:disabled\)\s*\{([^}]*)\}/m);

test('the connector-details field hover rule exists and uses the established field tint', () => {
  assert.ok(rule, 'expected the .connector-details input/select :hover rule');
  assert.match(rule[1], /background:\s*#e8eefb/);
});

test('the hover tint matches the data-dialog field hovers and the slice-90 search hover, so no new colour is introduced', () => {
  assert.ok(dataCss.match(/\.data-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\), \.data-dialog select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-dialog field hover must remain #e8eefb');
  assert.ok(css.match(/\.connector-search input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the connector-search hover must remain #e8eefb');
});

test('the field hover rule is paint-only: resting geometry and field presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting connector-details field rules are preserved', () => {
  assert.ok(css.match(/\.connector-details input, \.connector-details select\s*\{[^}]*background:\s*white/), 'the connector-details field resting background must remain white');
  assert.ok(css.match(/\.connector-details input:disabled, \.connector-details select:disabled\s*\{[^}]*background:\s*#f0f3f6/), 'the connector-details disabled field rule must remain');
  assert.ok(css.match(/\.connector-card:hover\s*\{[^}]*background:\s*#f8fbff/), 'the connector-card hover must remain');
});

defineHoverCases('connector-details-field hover', {
  html: `<div class="app-shell"><main><section class="data-sources"><div class="connector-layout">`
      + `<aside class="connector-details" aria-label="File setup"><form>`
      + `<label>Worksheet name<input id="targetInput" type="text"></label>`
      + `<label>Format<select id="targetSelect"><option>CSV</option></select></label>`
      + `<label>File<input id="fileInput" type="file"></label>`
      + `</form></aside></div></section></main></div>`
      + `<input id="outsideInput" type="text"><select id="outsideSelect"><option>CSV</option></select>`,
  cases: [
    {
      target: '#targetInput',
      rule: '.connector-details input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"]), .connector-details select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#fileInput', '#outsideInput', '#outsideSelect'],
    },
    {
      target: '#targetSelect',
      rule: '.connector-details input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"]), .connector-details select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
