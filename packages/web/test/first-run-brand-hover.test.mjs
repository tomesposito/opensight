import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 71: hover feedback for the first-run header's
// brand link (.first-run-header .brand in FirstRun.tsx). Verified lead
// from slice 70: this link matched zero :hover rules. The product
// header's brand hover (.product-header .brand:hover in app-chrome.css)
// is scoped to .product-header, and the first-run page is standalone
// (SessionGate renders it before any session, outside .app-shell), so
// no app-shell rule reaches it either. Its only rules set the white
// resting color (.first-run-header .brand) and the teal mark, so
// hovering it changed nothing while the same brand link in the product
// header tints on hover. It now takes that header's own dark-chrome
// hover tint (#365764, the .product-header .brand:hover tint), which
// matches the first-run header's dark #162e40 resting background.
// Background only, so resting geometry is identical and there is no
// animation.
const styleCss = styles['style.css'];
const appChromeCss = styles['app-chrome.css'];

const rule = styleCss.match(/\.first-run-header\s+\.brand:hover\s*\{([^}]*)\}/);

test('the first-run header brand has a hover state with the dark-chrome tint', () => {
  assert.ok(rule, 'expected the .first-run-header .brand hover rule');
  assert.match(rule[1], /background:\s*#365764/);
});

test('the brand hover tint matches the product-header brand hover tint', () => {
  assert.ok(appChromeCss.match(/\.product-header\s+\.brand:hover\s*\{[^}]*background:\s*#365764/), 'the product-header brand hover must remain #365764');
});

test('the brand hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting first-run header rules are preserved', () => {
  assert.ok(styleCss.match(/\.first-run-header\s*\{[^}]*background:\s*#162e40/), 'the header resting rule must remain');
  assert.ok(styleCss.match(/\.first-run-header \.brand\s*\{[^}]*color:\s*#fff/), 'the brand resting color must remain');
  assert.ok(styleCss.match(/\.first-run-header \.brand-mark\s*\{[^}]*color:\s*#72d3d4/), 'the brand-mark resting rule must remain');
});

test('the neighbouring first-run hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.first-run button:hover:not\(:disabled\), \.fixture-demo-banner button:hover\s*\{[^}]*background:\s*#eaf3f4/), 'the first-run button hover must remain');
  assert.ok(styleCss.match(/\.first-run-docs a:hover\s*\{[^}]*background:\s*#eaf3f4/), 'slice 63 docs-link hover must remain');
  assert.ok(styleCss.match(/\.first-run summary:hover\s*\{[^}]*background:\s*#eaf3f4/), 'slice 70 summary hover must remain');
});

defineHoverCases('first-run-brand hover', {
  html: `<div class="first-run"><header class="first-run-header"><a id="brand" class="brand" href="./"><span class="brand-wordmark">opensight</span></a><span>Open-source business intelligence</span></header></div>`
      + `<a id="outside" class="brand" href="./">Outside brand</a>`,
  cases: [
    {
      target: '#brand',
      rule: '.first-run-header .brand:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(54, 87, 100)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outside'],
    },
  ],
});
