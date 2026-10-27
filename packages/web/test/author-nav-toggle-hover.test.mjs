import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 35: hover feedback for the author-surface
// navigation toggle. A fresh behavioral hover audit (real mouse hover with
// computed-style delta measurement, Chromium, demo-mode bridge) finally
// covered the author analysis surface for the first time — landing and
// extended routes were exhausted by slices 16-34. It found
// `.author-workspace .app-header button.navigation-toggle` (the hamburger
// button in the author's dark topbar) had zero hover state: hovering it
// changed nothing. Slice 24's rule only covers `.product-header`, but the
// author header renders as `author-topbar app-header`, so the same button
// class had no hover rule on this surface. It takes the established
// dark-chrome hover tint (#365764, slices 24/33). Paint-only: the rule
// changes the background, so resting geometry is identical and there is no
// animation to need a reduced-motion variant.
const chromeCss = styles['app-chrome.css'];

const toggleRule = chromeCss.match(/\.author-workspace\s+\.app-header\s+\.navigation-toggle:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the author navigation toggle has a hover state with the dark-chrome tint', () => {
  assert.ok(toggleRule, 'expected .author-workspace .app-header .navigation-toggle:hover:not(:disabled)');
  assert.match(toggleRule[1], /background:\s*#365764/);
});

test('the author toggle hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(toggleRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(toggleRule[1]), 'hover must change background only');
});

test('the author toggle resting rule keeps the transparent base the hover replaces', () => {
  const base = chromeCss.match(/\.navigation-toggle\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the .navigation-toggle base rule');
  assert.match(base[1], /background:\s*transparent/);
  assert.match(base[1], /color:\s*#fff/);
});

defineHoverCases('author-nav-toggle hover', {
  html: `<div class="app-shell" data-page="author"><div class="author-workspace" data-chrome="light"><header class="app-header product-header">`
      + `<button class="navigation-toggle" id="t" aria-label="Toggle navigation">&#9776;</button>`
      + `</header></div></div>`,
  cases: [
    {
      target: '#t',
      rule: '.author-workspace .app-header .navigation-toggle:hover:not(:disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(54, 87, 100)' },
      paintOnly: true,
    },
  ],
});
