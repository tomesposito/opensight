import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 31: hover feedback for the data-prep selects.
// A fresh behavioral hover audit (real mouse hover + computed-style delta,
// Chromium, every top-level offline-demo route) found the prep document-bar
// selects — the saved-dataset picker and the imported-dataset picker on
// #/data/preparation — were the largest remaining interactive controls with
// zero hover feedback: hovering them changed nothing. The surface already
// gives its buttons a hover state (.data-prep button:hover) but selects had
// none, so they take the surface's own button hover tint (#edf6fc).
// Background only, so resting geometry is identical; disabled selects keep
// their flat state. Static (no animation), so no reduced-motion variant is
// needed.
const css = styles['style.css'];

const hoverRule = css.match(/\.data-prep\s+select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the prep select hover rule exists and uses the data-prep hover tint', () => {
  assert.ok(hoverRule, 'expected .data-prep select:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#edf6fc/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the prep select hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting prep-select rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.data-prep\s+(?:input,\s*)?\.data-prep\s+select[^{]*\{([^}]*)\}|(\.data-prep input, \.data-prep select, \.data-prep textarea \{[^}]*\})/);
  assert.ok(resting, 'expected the .data-prep select resting rule');
  assert.match(resting[0], /background:\s*white/);
  assert.match(resting[0], /border:\s*1px\s+solid/);
});

test('the prep select hover rule coexists with the prep button hover rule', () => {
  assert.ok(css.match(/\.data-prep\s+button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep button hover rule must still be present');
  assert.ok(hoverRule, 'expected the prep select hover rule');
});

defineHoverCases('prep-select hover', {
  html: `<div class="data-prep"><div class="prep-document-bar"><label>Dataset name<input value="demo"></label><label>Saved datasets<select><option value="">Unsaved dataset</option><option selected>demo-sales</option></select></label><label>Staged<select disabled><option>none</option></select></label></div></div>`,
  cases: [
    {
      target: '.prep-document-bar select:not([disabled])',
      rule: '.data-prep select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 246, 252)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['.prep-document-bar select[disabled]'],
    },
  ],
});
