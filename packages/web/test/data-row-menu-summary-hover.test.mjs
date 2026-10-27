import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 50: hover feedback for the Manage data dialog's
// per-dataset row-menu trigger (.data-row-menu summary, "More actions
// for …"). A fresh behavioral audit (real mouse hover + computed-style
// delta, Chromium) opening the Manage data dialog — a dialog no prior
// audit had opened — measured exactly one zero-hover control in it: this
// summary (28x24) went white -> white while every button in the same
// dialog tinted (.data-dialog button:hover, slices 16/30) and the menu's
// own item button tinted. Summary triggers elsewhere all take hover
// (card-footer slice 40, prep-execution slice 41, author-workspace
// slice 42); this one was missed because it is a <summary>, not a
// <button>. It now takes the data surface's tint (#eaf3f7, slices
// 16/21/27/48/49). Background only, so resting geometry is identical.
// Static (no animation), so no reduced-motion variant is needed.
const css = styles['data-section.css'];

const hoverRule = css.match(/\.data-row-menu summary:hover\s*\{([^}]*)\}/);

test('the row-menu summary hover rule exists and uses the data surface tint', () => {
  assert.ok(hoverRule, 'expected the .data-row-menu summary:hover rule');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the .data-row-menu summary hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting row-menu summary rules still reserve the geometry the hover keeps', () => {
  const resting = css.match(/\.data-row-menu summary\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .data-row-menu summary resting rule');
  assert.match(resting[1], /padding:\s*4px 6px/);
  assert.match(resting[1], /border:\s*1px solid #8ca6b4/);
  assert.match(resting[1], /background:\s*white/);
  assert.match(resting[1], /cursor:\s*pointer/);
});

test('the row-menu summary hover rule coexists with the dialog button hover rule', () => {
  assert.ok(css.match(/\.data-dialog button:hover:not\(:disabled\):not\(\.data-primary\)/), 'the .data-dialog button hover rule (slices 16/30) must still be present');
  assert.ok(css.match(/\.data-menu-items button:hover/), 'the data menu items hover rule must still be present');
  assert.ok(hoverRule, 'expected the .data-row-menu summary hover rule');
});

defineHoverCases('data-row-menu-summary hover', {
  html: `<details class="data-row-menu" id="menu">
      <summary id="trigger" aria-label="More actions for Sample sales data">⋯</summary>
      <div><button type="button">Remove dataset</button></div>
    </details>`,
  cases: [
    {
      target: '#trigger',
      rule: '.data-row-menu summary:hover',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
    },
  ],
});
