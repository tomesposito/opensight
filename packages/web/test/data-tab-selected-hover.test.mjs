import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 28: hover feedback for the selected data-page tab.
// A fresh interactive-state audit of the landing surfaces
// (home/my-stuff/analyses/dashboards/data, in-page CLS at 0 on every route,
// no page errors) found the selected tab (e.g. "Datasets", aria-selected=true)
// was the last interactive control on the landing surfaces with zero hover
// state: hovering it changed nothing, while the unselected tabs and the
// surrounding controls already take the data page's established menu-item
// hover tint (#e8eefb, slices 16/21/27). The selected tab takes the same tint
// on hover; its resting state (bg #eff4f6, bold, teal bottom border) stays
// distinct. Background only, so resting geometry is identical. Static (no
// animation), so no reduced-motion variant is needed.
const css = styles['data-section.css'];

const hoverRule = css.match(/\.data-tabs\s+button\[aria-selected=true\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the selected data tab has a hover state using the menu tint', () => {
  assert.ok(hoverRule, 'expected .data-tabs button[aria-selected=true]:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#e8eefb/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected .data-tabs button[aria-selected=true]:hover:not(:disabled)');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting selected-tab rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.data-tabs\s+button\[aria-selected=true\]\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .data-tabs button[aria-selected=true] resting rule');
  assert.match(resting[1], /background:\s*#eff4f6/);
  assert.match(resting[1], /border-bottom-color:\s*#2f66d8/);
});

test('the selected-tab hover rule coexists with the general tab hover rule', () => {
  assert.ok(css.match(/\.data-page\s+button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#e8eefb/), 'the unselected-tab hover rule (slice 16) must still be present');
  assert.ok(hoverRule, 'expected .data-tabs button[aria-selected=true]:hover:not(:disabled)');
});

defineHoverCases('data-tab-selected hover', {
  html: `<section class="data-page"><div class="data-tabs"><button type="button" role="tab" aria-selected="true">Datasets</button><button type="button" role="tab" aria-selected="false">Sources</button><button type="button" role="tab" aria-selected="true" disabled>Archived</button></div></section>`,
  cases: [
    {
      target: '.data-tabs button[aria-selected=true]:not([disabled])',
      rule: '.data-tabs button[aria-selected="true"]:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(239, 244, 246)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      excluded: [{ target: '.data-tabs button[aria-selected=true][disabled]', resting: { backgroundColor: 'rgb(239, 244, 246)' } }],
    },
  ],
});
