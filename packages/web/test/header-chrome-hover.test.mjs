import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 17: hover feedback for the persistent shell header
// chrome. A fresh interactive-state audit found the two header chrome controls
// present on every page — the brand logo link (a.brand) and the Account menu
// summary toggle — had zero hover state; hovering them changed nothing. Both
// now take the header's established dark-chrome state (#365764, the same tint
// the account menu's [open] state already uses). The brand's hover pill keeps
// the resting geometry identical (padding cancelled by negative margins), and
// the account-summary hover composes with slice 15's :active pressed shift.
const css = styles['app-chrome.css'];

test('brand link has a hover state using the dark-chrome tint', () => {
  const rule = css.match(/\.product-header\s+\.brand:hover\s*\{([^}]*)\}/);
  assert.ok(rule, 'expected .product-header .brand:hover');
  assert.match(rule[1], /background:\s*#365764/);
});

test('brand hover pill keeps resting geometry identical', () => {
  const rule = css.match(/\.product-header\s+\.brand\s*\{([^}]*)\}/);
  assert.ok(rule, 'expected .product-header .brand base rule');
  const pad = rule[1].match(/padding:\s*(-?\d+px)\s+(-?\d+px)/);
  const margin = rule[1].match(/margin:\s*(-?\d+px)\s+(-?\d+px)/);
  assert.ok(pad && margin, 'brand needs padding cancelled by negative margins');
  assert.equal(pad[1].replace('-', ''), margin[1].replace('-', ''));
  assert.equal(pad[2].replace('-', ''), margin[2].replace('-', ''));
});

test('account menu summary previews its open state on hover', () => {
  const hover = css.match(/\.account-menu\s+summary:hover\s*\{([^}]*)\}/);
  assert.ok(hover, 'expected .account-menu summary:hover');
  assert.match(hover[1], /background:\s*#365764/);
  const open = css.match(/\.account-menu\[open\]\s+summary\s*\{([^}]*)\}/);
  assert.ok(open, 'expected the .account-menu[open] summary rule to remain');
  assert.match(open[1], /background:\s*#365764/);
});

defineHoverCases('persistent header controls', {
  html: `<header class="product-header"><a id="brand" class="brand" href="#">OpenSight</a>
    <details class="account-menu"><summary id="account">Account</summary></details></header>`,
  cases: [
    { target: '#brand', rule: '.product-header .brand:hover' },
    { target: '#account', rule: '.account-menu summary:hover' },
  ].map(entry => ({
    ...entry,
    resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
    hovered: { backgroundColor: 'rgb(54, 87, 100)' },
    paintOnly: true,
    unchanged: ['color'],
  })),
});
