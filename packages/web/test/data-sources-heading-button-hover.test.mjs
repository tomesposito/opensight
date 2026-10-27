import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 92: hover feedback for the data-sources
// heading's "Prepare data" button (.app-shell .data-sources-heading
// > button in DataSources.tsx — section.data-sources inside
// .app-shell > main). It is a primary button (app-chrome.css rests
// it #157f88 with white text), but every button:hover rule in the
// cascade is scoped elsewhere — author, data-page/data-dialog,
// admin, collection, the product-header account panel, the
// workspace banner, the empty-page primary, the connector-submit
// in this same gallery — so it matched no :hover rule. A CSSOM
// probe with all five real stylesheets (1,344 rules) in the real
// ancestor context confirmed zero matching :hover rules and a
// #157f88 rest, while the gallery's search input (slice 90),
// details fields (slice 91) and submit (slice 66) do step. It now
// takes the app-wide primary hover step (#157f88 -> #126e76,
// slices 51/57/59/66), so no new colour is introduced. Background
// only, so resting geometry is identical and there is no
// animation. The gallery is a fixed-light app-shell surface, so
// no dark variant is added.
const css = styles['app-chrome.css'];

const rule = css.match(/^\.app-shell \.data-sources-heading > button:hover:not\(:disabled\)\s*\{([^}]*)\}/m);

test('the data-sources heading button hover rule exists and uses the primary hover step', () => {
  assert.ok(rule, 'expected the .data-sources-heading > button :hover rule');
  assert.match(rule[1], /background:\s*#126e76/);
});

test('the hover tint matches the connector-submit and account-panel primary hovers, so no new colour is introduced', () => {
  assert.ok(css.match(/\.app-shell \.connector-details button\.connector-submit:hover:not\(:disabled\)\s*\{[^}]*background:\s*#126e76/), 'the connector-submit hover must remain #126e76');
  assert.ok(css.match(/\.product-header \.account-menu \.account-panel button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#126e76/), 'the account-panel button hover must remain #126e76');
});

test('the heading button hover rule is paint-only: resting geometry and button presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting data-sources heading button rule is preserved', () => {
  assert.ok(css.match(/\.app-shell \.data-sources-heading > button\s*\{[^}]*background:\s*#157f88/), 'the heading button resting background must remain #157f88');
  assert.ok(css.match(/\.app-shell \.data-sources-heading > button\s*\{[^}]*color:\s*#fff/), 'the heading button resting label colour must remain white');
  assert.ok(css.match(/\.app-shell \.connector-submit\s*\{[^}]*background:\s*#157f88/), 'the app-shell connector-submit resting rule must remain');
});

defineHoverCases('data-sources-heading-button hover', {
  html: `<div class="app-shell"><main><section class="data-sources">`
      + `<div class="data-sources-heading"><div><h1 id="data-sources-title">Create a data set</h1></div><button id="targetBtn">Prepare data</button></div>`
      + `<div class="data-sources-heading"><button id="disabledBtn" disabled>Prepare data</button></div>`
      + `</section></main></div>`
      + `<button id="outsideBtn">Prepare data</button>`,
  cases: [
    {
      target: '#targetBtn',
      rule: '.app-shell .data-sources-heading > button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(21, 127, 136)' },
      hovered: { backgroundColor: 'rgb(18, 110, 118)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#disabledBtn', '#outsideBtn'],
    },
  ],
});
