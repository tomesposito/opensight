import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 85: hover feedback for the plain DataMenu
// overflow summary (.data-menu > summary in DataSectionUI.tsx's
// DataMenu — the ⋮ trigger in the Data landing's dataset rows and
// DatasetDetail's standalone "Dataset actions" menu). Slice 16 gave
// the split-button variant its hover (.data-split > .data-menu >
// summary:hover, #145d76 on its teal #176b88 rest), but the plain
// variant rests transparent and matched no :hover rule: the data
// page's button hover is button-only and a summary is not a button,
// and every other summary:hover rule is scoped elsewhere. A CSSOM
// probe with all five real stylesheets (1,337 rules) in the real
// ancestor context confirmed zero matching :hover rules and a
// transparent rest, while the split neighbour rests rgb(23,107,136).
// It now takes the data surface's established hover tint (#eaf3f7),
// so no new colour is introduced. The split rule (0,3,1) still beats
// this rule (0,2,1) for the split variant, so its teal hover is
// unchanged. Background only, so resting geometry is identical and
// there is no animation; the data surface is fixed light, so no
// dark variant is added.
const css = styles['data-section.css'];

const rule = css.match(/^\.data-menu > summary:hover\s*\{([^}]*)\}/m);

test('the plain data-menu summary hover rule exists and uses the data surface tint', () => {
  assert.ok(rule, 'expected the .data-menu > summary:hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint is the established data-surface hover tint, distinct from the transparent rest', () => {
  assert.ok(css.match(/\.data-page button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page button hover must remain #eaf3f7');
  assert.ok(css.match(/\.data-row-menu summary:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the row-menu summary hover must remain #eaf3f7');
  assert.notEqual('#eaf3f7', 'transparent', 'the hover tint must differ from the resting state');
});

test('the split-button variant keeps its own teal hover rule', () => {
  assert.ok(css.match(/\.data-split > \.data-menu > summary:hover\s*\{[^}]*background:\s*#145d76/), 'the slice-16 split summary hover must remain #145d76');
  assert.ok(css.match(/\.data-split > \.data-menu > summary\s*\{[^}]*background:\s*#176b88/), 'the split summary resting rule must remain #176b88');
});

test('the summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting data-menu rules are preserved', () => {
  assert.ok(css.match(/\.data-menu > summary\s*\{[^}]*list-style:\s*none; padding:\s*0 8px; font-size:\s*16px; cursor:\s*pointer/), 'the data-menu summary resting rule must remain');
  assert.ok(css.match(/\.data-menu-items button:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the data-menu-items button hover must remain #eaf3f7');
});

test('the neighbouring summary hover rules are untouched', () => {
  assert.ok(css.match(/\.data-summary-cards details > summary:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the slice-81 storage-settings summary hover must remain #eaf3f7');
  assert.ok(css.match(/\.data-row-menu summary:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the row-menu summary hover must remain #eaf3f7');
});

defineHoverCases('data-menu-summary hover', {
  html: `<div class="data-page"><table class="data-table"><tbody><tr><td><details class="data-menu"><summary id="target" aria-label="Actions for Sales">⋮</summary></details></td></tr></tbody></table>`
      + `<div class="data-split"><button class="data-primary">Create dataset</button><details class="data-menu"><summary id="split">v</summary></details></div>`
      + `<details class="data-row-menu"><summary id="rowmenu">…</summary></details></div>`,
  cases: [
    {
      target: '#target',
      rule: '.data-menu > summary:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      excluded: ['#rowmenu'],
    },
    {
      target: '#split',
      rule: '.data-page .data-primary:hover:not(:disabled), .data-dialog .data-primary:hover:not(:disabled), .data-split > .data-menu > summary:hover',
      resting: { backgroundColor: 'rgb(23, 107, 136)' },
      hovered: { backgroundColor: 'rgb(20, 93, 118)' },
      paintOnly: true,
    },
  ],
});
