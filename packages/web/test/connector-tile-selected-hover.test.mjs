import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 76: hover feedback for the Create Dataset
// dialog's selected connector tile (.data-connector-tile[data-selected=true]
// in CreateDatasetDialog.tsx, stage 'source'). Slice 49 gave the
// unselected enabled tiles the data surface's hover tint (#eaf3f7) and
// deliberately excluded the selected tile because it already rests
// distinct at #f0f8fb with the #176b88 border — so hovering the chosen
// tile changed nothing, while every unselected enabled tile steps
// white -> #eaf3f7. A real-mouse probe on the demo dialog measured the
// selected tile (301x82) at rgb(240,248,251) on rest and hover alike.
// Following slice 28's selected-tab language (the selected data tab
// takes the surface hover tint on hover), the selected tile now takes
// the same established tint on hover: one visible step deeper than its
// resting #f0f8fb, distinct at rest via tint + border, both kept.
// A selected tile whose connector is unimplemented carries a disabled
// radio and is excluded via :has(> input:disabled), so it keeps its
// flat resting state. Background only, so resting geometry is
// identical; static (no animation), so no reduced-motion variant.
const css = styles['data-section.css'];

const rule = css.match(/\.data-connector-tile\[data-selected=true\]:hover:not\(:has\(> input:disabled\)\)\s*\{([^}]*)\}/);

test('the selected connector-tile hover rule exists and uses the data surface tint', () => {
  assert.ok(rule, 'expected the .data-connector-tile[data-selected=true]:hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint is the established data hover tint, deeper than the selected rest tint', () => {
  assert.ok(css.match(/\.data-page button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{\s*background:\s*#eaf3f7/), 'the slice 16 data-page hover tint must remain #eaf3f7');
  assert.ok(css.match(/\.data-tabs button\[aria-selected=true\]:hover:not\(:disabled\)\s*\{\s*background:\s*#eaf3f7/), 'the slice 28 selected-tab hover precedent must remain #eaf3f7');
  const selected = css.match(/\.data-connector-tile\[data-selected=true\]\s*\{([^}]*)\}/);
  assert.ok(selected, 'expected the selected tile resting rule');
  assert.match(selected[1], /background:\s*#f0f8fb/);
  assert.notEqual('#eaf3f7', '#f0f8fb', 'the hover tint must differ from the resting tint');
});

test('the selected-tile hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting tile rules are preserved', () => {
  const resting = css.match(/\.data-connector-tile\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .data-connector-tile resting rule');
  assert.match(resting[1], /padding:\s*16px 12px/);
  assert.match(resting[1], /border:\s*1px solid #d3dfe5/);
  assert.match(resting[1], /cursor:\s*pointer/);
  const selected = css.match(/\.data-connector-tile\[data-selected=true\]\s*\{([^}]*)\}/);
  assert.ok(selected, 'expected the selected tile resting rule');
  assert.match(selected[1], /border-color:\s*#176b88/);
  assert.match(selected[1], /background:\s*#f0f8fb/);
});

test('the neighbouring data-dialog hovers are untouched', () => {
  assert.ok(css.match(/\.data-connector-tile:hover:not\(\[data-selected=true\]\):not\(:has\(> input:disabled\)\)\s*\{\s*background:\s*#eaf3f7/), 'the slice 49 unselected tile hover must remain');
  assert.ok(css.match(/\.data-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\)/), 'the slice 48 data-dialog field hover must remain');
  assert.ok(css.match(/\.data-dialog button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{\s*background:\s*#eaf3f7/), 'the slice 30 data-dialog button hover must remain');
});

defineHoverCases('connector-tile-selected hover', {
  html: `<div class="data-connector-grid">
      <label class="data-connector-tile" id="selected" data-selected="true"><span aria-hidden="true">▤</span><span><strong>File upload</strong><small>.csv</small></span><input type="radio" name="connector" checked></label>
      <label class="data-connector-tile" id="unselected" data-selected="false"><span aria-hidden="true">▤</span><span><strong>PostgreSQL</strong><small>Connected</small></span><input type="radio" name="connector"></label>
      <label class="data-connector-tile" id="selected-disabled" data-selected="true"><span aria-hidden="true">▤</span><span><strong>MySQL</strong><small>Not available</small></span><input type="radio" name="connector" disabled></label>
    </div>`,
  cases: [
    {
      target: '#selected',
      rule: '.data-connector-tile[data-selected="true"]:hover:not(:has(> input:disabled))',
      resting: { backgroundColor: 'rgb(240, 248, 251)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['borderTopColor'],
      excluded: [{ target: '#unselected', resting: { backgroundColor: 'rgba(0, 0, 0, 0)' } }, '#selected-disabled'],
    },
  ],
});
