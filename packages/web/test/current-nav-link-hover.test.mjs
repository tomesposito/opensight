import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 73: hover feedback for the left rail's
// current-page link (.product-navigation .app-nav a[aria-current] in
// AppNavigation.tsx). Its resting selected background is #dceff0 — the
// exact tint the generic rail hover paints — and the [aria-current] rule
// ties the hover rule at (0,3,1) and stands after it, so hovering the
// current link changed nothing on any route, while every other rail link
// steps transparent -> #dceff0. A fresh whole-demo behavioral audit (real
// mouse + computed-style delta) flagged it on every route audited.
// Following the slices 28/29 selected-control language, the current link
// now takes a dedicated hover step: #cddde0, one visible step deeper than
// #dceff0 and already in the palette (the author-canvas dot grid). The
// selector's (0,4,1) specificity beats both the generic hover and the
// resting selected rule. Background only, so the selected border, teal
// text and weight are unchanged and resting geometry is identical.
const appChromeCss = styles['app-chrome.css'];
const styleCss = styles['style.css'];

const rule = appChromeCss.match(/\.product-navigation\s+\.app-nav\s+a\[aria-current\]:hover\s*\{([^}]*)\}/);

test('the current rail link has a hover state one step deeper than its selected tint', () => {
  assert.ok(rule, 'expected the .product-navigation .app-nav a[aria-current]:hover rule');
  assert.match(rule[1], /background:\s*#cddde0/);
});

test('the hover tint is an existing palette color and differs from both rail tints', () => {
  assert.ok(styleCss.match(/\.author-canvas\s*\{[^}]*#cddde0/), 'the canvas dot grid must keep #cddde0 in the palette');
  assert.ok(appChromeCss.match(/\.product-navigation \.app-nav a:hover\s*\{[^}]*background:\s*#dceff0/), 'the generic rail hover must remain #dceff0');
  assert.ok(appChromeCss.match(/\.product-navigation \.app-nav a\[aria-current\]\s*\{[^}]*background:\s*#dceff0/), 'the resting selected background must remain #dceff0');
});

test('the current-link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting current-link rule is preserved', () => {
  assert.ok(appChromeCss.match(/\.product-navigation \.app-nav a\[aria-current\]\s*\{[^}]*border-color:\s*#157f88[^}]*background:\s*#dceff0[^}]*color:\s*#126e76[^}]*font-weight:\s*600/), 'the resting selected rule must remain');
});

test('the neighbouring rail hovers are untouched', () => {
  assert.ok(appChromeCss.match(/\.product-navigation \.rail-search:hover, \.product-navigation \.rail-more:hover,\s*\.product-navigation \.app-nav a:hover\s*\{\s*background:\s*#dceff0/), 'the generic rail hover must remain');
  assert.ok(appChromeCss.match(/\.rail-recents a:hover\s*\{[^}]*color:\s*#126e76/), 'the recents link hover must remain');
  assert.ok(appChromeCss.match(/\.app-shell \.workspace-banner button:hover:not\(:disabled\)\s*\{\s*background:\s*#dceff0/), 'the slice 62 workspace-banner hover must remain');
});

defineHoverCases('current-nav-link hover', {
  html: `<aside class="product-navigation"><nav class="app-nav" aria-label="Product"><a id="plain" href="#/home">Home</a><a id="current" href="#/analyses" aria-current="page">Analyses</a></nav></aside>`
      + `<p><a id="outside" href="#/home" aria-current="page">Outside the rail</a></p>`,
  cases: [
    {
      target: '#current',
      rule: '.product-navigation .app-nav a[aria-current]:hover',
      resting: { backgroundColor: 'rgb(220, 239, 240)' },
      hovered: { backgroundColor: 'rgb(205, 221, 224)' },
      paintOnly: true,
      unchanged: ['color', 'fontWeight'],
      excluded: ['#plain', '#outside'],
    },
  ],
});
