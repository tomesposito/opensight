import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 74: hover feedback for a section nav's
// current link (.section-nav a[aria-current] in AppNavigation.tsx) in
// both of its contexts — the top section nav (.app-shell >
// .section-nav, Data) and the rail's section groups
// (.product-navigation .section-nav, Analyses/Admin/Developer tools).
// Its resting selected background is #eef3fd — the exact tint the
// generic nav hover paints — and both rules tie at (0,2,1), so
// hovering the current link changed nothing on any route, while every
// plain section link steps transparent -> #eef3fd. app-chrome.css adds
// no section-nav link background (only padding, border and radius), so
// the style.css cascade governs both contexts. Following the slices
// 28/29 selected-control language (and slice 73 for the rail's app-nav
// current link), the current link now takes a dedicated hover step:
// #d9e6fa, one visible step deeper than #eef3fd and already in the
// palette (the rail hover/selected tint). The selector's (0,3,1)
// specificity beats both the generic hover and the resting selected
// rule. Scope is .section-nav only: .app-nav renders only inside the
// rail, where slice 73's rule already governs its current link.
// Background only, so the selected border and teal text are unchanged
// and resting geometry is identical.
const styleCss = styles['style.css'];
const appChromeCss = styles['app-chrome.css'];

const rule = styleCss.match(/\.section-nav\s+a\[aria-current\]:hover\s*\{([^}]*)\}/);

test('the current section link has a hover state one step deeper than its selected tint', () => {
  assert.ok(rule, 'expected the .section-nav a[aria-current]:hover rule');
  assert.match(rule[1], /background:\s*#d9e6fa/);
});

test('the hover tint is an existing palette color and differs from the section tint', () => {
  assert.ok(appChromeCss.match(/\.product-navigation \.app-nav a\[aria-current\]\s*\{[^}]*background:\s*#d9e6fa/), 'the rail selected tint must keep #d9e6fa in the palette');
  assert.ok(styleCss.match(/\.app-nav a:hover, \.section-nav a:hover\s*\{\s*background:\s*#eef3fd/), 'the generic nav hover must remain #eef3fd');
  assert.ok(styleCss.match(/\.app-nav a\[aria-current\], \.section-nav a\[aria-current\]\s*\{[^}]*background:\s*#eef3fd/), 'the resting selected background must remain #eef3fd');
});

test('the current-link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting current-link rule is preserved', () => {
  assert.ok(styleCss.match(/\.app-nav a\[aria-current\], \.section-nav a\[aria-current\]\s*\{\s*color:\s*#2f66d8;\s*border-color:\s*#3b82f6;\s*background:\s*#eef3fd/), 'the resting selected rule must remain');
});

test('the neighbouring nav hovers are untouched', () => {
  assert.ok(styleCss.match(/\.app-nav a:hover, \.section-nav a:hover\s*\{\s*background:\s*#eef3fd/), 'the generic nav hover must remain');
  assert.ok(appChromeCss.match(/\.product-navigation \.app-nav a\[aria-current\]:hover\s*\{\s*background:\s*#cddde0/), 'the slice 73 rail current-link hover must remain');
  assert.ok(appChromeCss.match(/\.product-navigation \.section-nav a\s*\{[^}]*border-radius:\s*4px/), 'the rail section-nav link layout must remain');
  assert.ok(appChromeCss.match(/\.app-shell > \.section-nav a, \.app-shell > \.admin-navigation \.section-nav a\s*\{[^}]*padding:\s*8px 0/), 'the top section-nav link layout must remain');
});

defineHoverCases('section-nav-current hover', {
  html: `<div class="app-shell"><nav class="section-nav" aria-label="Data"><a id="top-plain" href="#/data">Data sources</a><a id="top-current" href="#/data/preparation" aria-current="page">Preparation</a></nav>`
      + `<aside class="product-navigation"><nav class="section-nav" aria-label="Admin"><a id="rail-plain" href="#/admin/users">Users</a><a id="rail-current" href="#/admin/security" aria-current="page">Security</a></nav></aside>`
      + `<p><a id="outside" href="#/home" aria-current="page">Outside any section nav</a></p></div>`,
  cases: [
    {
      target: '#top-current',
      rule: '.section-nav a[aria-current]:hover',
      resting: { backgroundColor: 'rgb(238, 243, 253)' },
      hovered: { backgroundColor: 'rgb(217, 230, 250)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#top-plain', '#outside'],
    },
    {
      target: '#rail-current',
      rule: '.section-nav a[aria-current]:hover',
      resting: { backgroundColor: 'rgb(238, 243, 253)' },
      hovered: { backgroundColor: 'rgb(217, 230, 250)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
