import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 24: hover feedback for the shell header's
// navigation toggle. A fresh interactive-state audit of the app shell found
// `.navigation-toggle` (the hamburger button in `.product-header`, visible on
// narrow viewports and always in author mode) was the last header-chrome
// control with zero hover state: hovering it changed nothing. Its siblings
// already carry the established dark-chrome hover language from slice 17
// (`.product-header .brand:hover`, `.account-menu summary:hover`), so the
// toggle takes the same tint (#365764). Paint-only: the rule changes the
// background, so resting geometry is identical and there is no animation to
// need a reduced-motion variant.
const chromeCss = styles['app-chrome.css'];

const toggleRule = chromeCss.match(/\.product-header\s+\.navigation-toggle:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the header navigation toggle has a hover state with the dark-chrome tint', () => {
  assert.ok(toggleRule, 'expected .product-header .navigation-toggle:hover:not(:disabled)');
  assert.match(toggleRule[1], /background:\s*#365764/);
});

test('the toggle hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(toggleRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(toggleRule[1]), 'hover must change background only');
});

test('the toggle resting rule keeps the transparent base the hover replaces', () => {
  const base = chromeCss.match(/\.navigation-toggle\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the .navigation-toggle base rule');
  assert.match(base[1], /background:\s*transparent/);
});

defineHoverCases('navigation-toggle hover', {
  // The navigation toggle is visible below the shell's 760px breakpoint.
  viewport: { width: 700, height: 600 },
  html: `<header class="product-header"><button class="navigation-toggle" id="nav">☰</button><button class="navigation-toggle" id="dis" disabled>☰</button></header>`,
  cases: [
    {
      target: '#nav',
      rule: '.product-header .navigation-toggle:hover:not(:disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(54, 87, 100)' },
      paintOnly: true,
      excluded: [{ target: '#dis', resting: { backgroundColor: 'rgba(0, 0, 0, 0)' } }],
    },
  ],
});
