import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 30: hover feedback for the create-dataset dialog's
// plain buttons. A fresh behavioral hover audit extended past the 5 landing
// routes to every top-level offline-demo route (folders, data-prep, data
// sources, dataset/admin surfaces, #/analyses/new, #/data/new) found the
// "Upload file" and "Create data source" buttons in the create-dataset
// dialog's .data-dialog-tools row were the largest remaining interactive
// controls with zero hover feedback: hovering them changed nothing.
// Slice 16's rule covered .data-page buttons but not .data-dialog buttons,
// and the dialog buttons share the data surface's plain-button style (white
// bg, teal text), so they take the same established menu-item tint (#e8eefb).
// This also gives the dialog header/footer plain buttons hover feedback for
// the first time. Background only, so resting geometry is identical; disabled
// buttons keep their flat state. Static (no animation), so no reduced-motion
// variant is needed.
const css = styles['data-section.css'];

const hoverRule = css.match(/\.data-dialog\s+button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{([^}]*)\}/);

test('the dialog plain-button hover rule exists and uses the menu tint', () => {
  assert.ok(hoverRule, 'expected .data-dialog button:hover:not(:disabled):not(.data-primary):not([aria-selected=true])');
  assert.match(hoverRule[1], /background:\s*#e8eefb/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the dialog plain-button hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting dialog-button rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.data-dialog\s+button\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .data-dialog button resting rule');
  assert.match(resting[1], /background:\s*white/);
  assert.match(resting[1], /border:\s*1px\s+solid/);
});

test('the dialog-button hover rule coexists with the data-page button rule', () => {
  assert.ok(css.match(/\.data-page\s+button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-page plain-button hover rule (slice 16) must still be present');
  assert.ok(hoverRule, 'expected the dialog plain-button hover rule');
});

defineHoverCases('data-dialog-button hover', {
  html: `<div class="data-page"><dialog class="data-dialog" open><div class="data-dialog-body"><div class="data-dialog-tools"><button type="button">Upload file</button><button type="button" disabled>Staged</button><button type="button" class="data-primary">Continue</button></div></div></dialog></div>`,
  cases: [
    {
      target: '.data-dialog-tools button:not([disabled]):not(.data-primary)',
      rule: '.data-dialog button:hover:not(:disabled):not(.data-primary):not([aria-selected="true"])',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['.data-dialog-tools button.data-primary', '.data-dialog-tools button[disabled]'],
    },
  ],
});
