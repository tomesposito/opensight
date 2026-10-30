import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 90: hover feedback for the connector
// gallery's search input (.connector-search input[type=search] in
// DataSources.tsx — "Find a data source", in the .connector-picker of
// the standalone gallery, section.data-sources inside .app-shell >
// main). Every input:hover rule in the cascade is scoped elsewhere —
// author-workspace/author-layout, data-page/data-dialog (the gallery
// page is not .data-page and the standalone gallery is not a
// .data-dialog), admin-settings, the analysis-file/calculation
// dialogs, embed, sign-in, the Q side panel, the command
// palette/global search, collection-card — so this input matched no
// :hover rule. A CSSOM probe with all five real stylesheets (1,342
// rules) in the real ancestor context confirmed zero matching :hover
// rules and a white rest, while the gallery's cards
// (.connector-card:hover) and its submit (slice 66) do step. It now
// takes the app surfaces' established field hover tint (#e8eefb — the
// data search inputs, slices 27/48, and the collection fields, slices
// 23/64). Background only, so resting colour and geometry are
// unchanged. The gallery is a fixed-light app-shell surface, so no
// dark variant is added.
const css = styles['style.css'];
const dataCss = styles['data-section.css'];

const rule = css.match(/^\.connector-search input\[type=search\]:hover:not\(:disabled\)\s*\{([^}]*)\}/m);

test('the connector-search hover rule exists and uses the established field tint', () => {
  assert.ok(rule, 'expected the .connector-search input[type=search]:hover rule');
  assert.match(rule[1], /background:\s*#e8eefb/);
});

test('the hover tint matches the data search-input hovers, so no new colour is introduced', () => {
  assert.ok(dataCss.match(/\.data-page input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-page search hover must remain #e8eefb');
  assert.ok(dataCss.match(/\.data-dialog input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-dialog search hover must remain #e8eefb');
});

test('the search hover rule is paint-only: resting geometry and field presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting connector-search rules are preserved', () => {
  assert.ok(css.match(/\.connector-search\s*\{[^}]*display:\s*grid/), 'the connector-search resting rule must remain');
  assert.ok(css.match(/\.connector-search input\s*\{[^}]*background:\s*white/), 'the search input resting background must remain white');
  assert.ok(css.match(/\.connector-card:hover\s*\{[^}]*background:\s*#f8fbff/), 'the connector-card hover must remain');
});

defineHoverCases('connector-search hover', {
  html: `<div class="app-shell"><main><section class="data-sources"><div class="connector-layout"><div class="connector-picker">`
      + `<label class="connector-search">Find a data source<input id="target" type="search" placeholder="Search data sources"></label>`
      + `</div></div></section></main></div>`
      + `<input id="outside" type="search">`,
  cases: [
    {
      target: '#target',
      rule: '.connector-search input[type="search"]:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outside'],
    },
  ],
});
