import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 34: hover feedback for the fixture-notice "Open
// Home" link. A fresh behavioral hover audit (real mouse hover with
// computed-style delta measurement, Chromium, demo-mode bridge) found this
// link (Developer fixture preview page: "Questions are unavailable for
// definition previews. Open Home to explore sample sales data.") as the last
// user-facing control with zero hover state — hovering the link changed
// nothing. The landing-surface hover thread stays complete since slice 29.
// The app-wide menu-item tint (#e8eefb, slices 16/21/25/26/30/32) is
// invisible against the notice's own #e8eefb background, so the link takes
// the palette's darker blue-gray step (#d7e0ee). Paint-only: the rule
// changes the background, so resting geometry is identical and there is no
// animation to need a reduced-motion variant.
const styleCss = styles['style.css'];

const linkRule = styleCss.match(/\.fixture-notice\s+a:hover\s*\{([^}]*)\}/);

test('the fixture-notice link has a hover state with the darker palette tint', () => {
  assert.ok(linkRule, 'expected .fixture-notice a:hover');
  assert.match(linkRule[1], /background:\s*#d7e0ee/);
});

test('the notice-link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(linkRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|text-decoration/.test(linkRule[1]), 'hover must change background only');
});

test('the notice link has no resting background of its own to disturb', () => {
  // The parent .fixture-notice carries the tinted background; the link
  // itself rests transparent, so adding a hover background is additive.
  const linkRest = styleCss.match(/\.fixture-notice\s+a\s*\{([^}]*)\}/);
  assert.ok(!linkRest || !/background:/.test(linkRest[1]), 'no resting background on the link itself');
});

defineHoverCases('fixture-notice-link hover', {
  html: `<section><p class="fixture-notice">Questions are unavailable for definition previews. <a href="#/home" id="a">Open Home to explore sample sales data.</a></p></section>`,
  cases: [
    {
      target: '#a',
      rule: '.fixture-notice a:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(215, 224, 238)' },
      paintOnly: true,
      unchanged: ['color', 'textDecorationLine'],
    },
  ],
});
