import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 33: hover feedback for the fixture-picker select in
// the product header (Developer fixture preview page). A fresh behavioral
// hover audit (real mouse hover with computed-style delta measurement,
// Chromium, demo-mode bridge) re-audited the landing routes (0 candidates:
// the landing-surface hover thread stays complete since slice 29), the
// folders/data routes (0 real: the Data page's "Create data source" hit is
// the known closed-<details> false positive from slice 32), and — after
// expanding the rail's collapsed "More" disclosure — the admin/developer
// routes, finding `.product-header .fixture-picker select` as the largest
// real user-facing control with zero hover state. It takes the header's own
// hover tint (#365764, like the brand mark, navigation toggle and account
// menu) with light text so the dark resting text stays readable. Paint-only:
// the rule changes background and color, so resting geometry is identical
// and there is no animation to need a reduced-motion variant.
const chromeCss = styles['app-chrome.css'];

const selectRule = chromeCss.match(/\.product-header\s+\.fixture-picker\s+select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the fixture-picker select has a hover state with the header tint', () => {
  assert.ok(selectRule, 'expected .product-header .fixture-picker select:hover:not(:disabled)');
  assert.match(selectRule[1], /background:\s*#365764/);
  assert.match(selectRule[1], /color:\s*#fff/);
});

test('the fixture-picker hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(selectRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|text-decoration/.test(selectRule[1]), 'hover must change background/color only');
});

test('the fixture-picker resting rule is preserved', () => {
  const base = chromeCss.match(/\.product-header\s+\.fixture-picker\s+select\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the resting select rule');
  assert.ok(!/background:|color:/.test(base[1]), 'resting rule must not set background or color');
  assert.match(base[1], /max-width:\s*260px/);
});

defineHoverCases('fixture-picker-select hover', {
  html: `<header class="app-shell"><div class="product-header"><label class="fixture-picker">Definition example<select id="s"><option>TotalDeathByCountry</option><option>Renderable Sales (Synthetic)</option></select></label></div></header>`,
  cases: [
    {
      target: '#s',
      rule: '.product-header .fixture-picker select:hover:not(:disabled)',
      // The complete cascade includes style.css's base select treatment.
      resting: { backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(25, 56, 74)' },
      hovered: { backgroundColor: 'rgb(54, 87, 100)', color: 'rgb(255, 255, 255)' },
      paintOnly: true,
    },
  ],
});
