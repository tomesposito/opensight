import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 89: hover feedback for the standalone author
// topbar's brand link (Author.tsx — a plain <a class="brand"> inside
// header.author-topbar.app-header in .author-workspace, rendered only
// when the author is not embedded in the app shell and no identity
// renderer is supplied). The other two brand-link instances already
// hover — .product-header .brand:hover and .first-run-header
// .brand:hover (slice 71), both #2b3a55 — but each is scoped to its
// own header, every other a:hover rule is scoped elsewhere, and the
// author generic hovers are button/input/select/textarea/
// summary-typed, so this link matched no :hover rule. A CSSOM probe
// with all five real stylesheets (1,341 rules) in the real ancestor
// context confirmed zero matching :hover rules and a transparent
// rest. It now takes the brand links' established dark-header hover
// tint (#2b3a55). The header variables are shared by both editor
// chromes, so no dark variant is added. Background only, so resting
// colour and geometry are unchanged.
const css = styles['style.css'];
const appChromeCss = styles['app-chrome.css'];

const rule = css.match(/^\.author-topbar \.brand:hover\s*\{([^}]*)\}/m);

test('the author-topbar brand hover rule exists and uses the brand hover tint', () => {
  assert.ok(rule, 'expected the .author-topbar .brand:hover rule');
  assert.match(rule[1], /background:\s*#2b3a55/);
});

test('the hover tint matches the other brand-link hovers, so no new colour is introduced', () => {
  assert.ok(appChromeCss.match(/\.product-header\s+\.brand:hover\s*\{[^}]*background:\s*#2b3a55/), 'the product-header brand hover must remain #2b3a55');
  assert.ok(css.match(/\.first-run-header\s+\.brand:hover\s*\{[^}]*background:\s*#2b3a55/), 'the first-run brand hover must remain #2b3a55');
});

test('the brand hover rule is paint-only: resting geometry and link presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:|text-decoration/.test(rule[1]), 'hover must change background only');
});

test('the resting author-topbar rules are preserved', () => {
  assert.ok(css.match(/\.author-workspace \.author-topbar\s*\{[^}]*background:\s*var\(--header-bg\)/), 'the author topbar resting rule must remain');
  assert.ok(css.match(/\.author-topbar \.brand\s*\{[^}]*color:\s*var\(--header-text\)/), 'the brand resting colour must remain');
  assert.ok(css.match(/\.author-topbar \.brand-mark\s*\{[^}]*color:\s*var\(--header-muted\)/), 'the brand-mark resting rule must remain');
});

defineHoverCases('author-topbar-brand hover', {
  html: `<div class="author-workspace" data-chrome="light"><header class="author-topbar app-header">`
      + `<a id="target" class="brand" href="./"><span class="brand-mark" aria-hidden="true">O</span><span class="brand-wordmark">opensight</span></a>`
      + `</header></div>`
      + `<a id="outside" class="brand" href="./">Outside brand</a>`,
  cases: [
    {
      target: '#target',
      rule: '.author-topbar .brand:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(43, 58, 85)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outside'],
    },
  ],
});
