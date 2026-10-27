import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 49: hover feedback for the Create Dataset
// dialog's connector tiles. Slice 48's behavioral audit (real mouse hover
// + computed-style delta, Chromium, creation dialogs opened) measured the
// connector tiles (.data-connector-tile, 301x82) zero-hover and left them
// as the next lead, pending the selection-card question that slice 45
// settled for the sheet-type cards: an enabled selection card takes the
// surface hover tint. The tiles are labels with a pointer cursor and a
// resting border, while every field and button around them in the same
// dialog tinted (slices 16/30/48). An unselected, enabled tile now takes
// the data surface's tint (#eaf3f7, slices 16/21/27/48). The selected
// tile is excluded: it already rests distinct at #f0f8fb with the teal
// border. Tiles whose connector is unimplemented carry a disabled radio
// and are excluded via :has(> input:disabled), so they keep their flat
// resting state. Background only, so resting geometry is identical;
// static (no animation), so no reduced-motion variant is needed.
const css = styles['data-section.css'];

const hoverRule = css.match(/\.data-connector-tile:hover:not\(\[data-selected=true\]\):not\(:has\(> input:disabled\)\)\s*\{([^}]*)\}/);

test('the connector-tile hover rule exists and uses the data surface tint', () => {
  assert.ok(hoverRule, 'expected the .data-connector-tile hover rule');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the .data-connector-tile hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting tile rules still reserve the geometry the hover keeps', () => {
  const resting = css.match(/\.data-connector-tile\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .data-connector-tile resting rule');
  assert.match(resting[1], /padding:\s*16px 12px/);
  assert.match(resting[1], /border:\s*1px solid #d3dfe5/);
  assert.match(resting[1], /cursor:\s*pointer/);
  const selected = css.match(/\.data-connector-tile\[data-selected=true\]\s*\{([^}]*)\}/);
  assert.ok(selected, 'expected the selected tile resting rule');
  assert.match(selected[1], /background:\s*#f0f8fb/);
  assert.match(selected[1], /border-color:\s*#176b88/);
});

test('the tile hover rule coexists with the data-dialog field hover rule', () => {
  assert.ok(css.match(/\.data-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\)/), 'the data-dialog field hover rule (slice 48) must still be present');
  assert.ok(hoverRule, 'expected the .data-connector-tile hover rule');
});

defineHoverCases('data-connector-tile hover', {
  html: `<div class="data-connector-grid">
      <label class="data-connector-tile" id="enabled" data-selected="false"><span aria-hidden="true">▤</span><span><strong>File upload</strong><small>.csv</small></span><input type="radio" name="connector"></label>
      <label class="data-connector-tile" id="selected" data-selected="true"><span aria-hidden="true">▤</span><span><strong>PostgreSQL</strong><small>Connected</small></span><input type="radio" name="connector" checked></label>
      <label class="data-connector-tile" id="disabled" data-selected="false"><span aria-hidden="true">▤</span><span><strong>MySQL</strong><small>Not available</small></span><input type="radio" name="connector" disabled></label>
    </div>`,
  cases: [
    {
      target: '#enabled',
      rule: '.data-connector-tile:hover:not([data-selected="true"]):not(:has(> input:disabled))',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      excluded: [{ target: '#selected', resting: { backgroundColor: 'rgb(240, 248, 251)' } }, '#disabled'],
    },
  ],
});
