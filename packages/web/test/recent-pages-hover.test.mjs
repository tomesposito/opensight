import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 26: hover feedback for the "Recent pages" rows on
// the My stuff page. A fresh interactive-state audit of the landing surfaces
// (home/analyses/dashboards/data/my-stuff, with the earlier click-navigation
// mid-transition race fixed) found `ul.recent-pages > li > a` was the last
// control class with zero hover state: hovering a recent-page row changed
// nothing. They take the app-wide menu-item hover tint (#e8eefb,
// slices 16/21/25). Paint-only: the rule changes the background, so resting
// geometry is identical and there is no animation to need a reduced-motion
// variant.
const chromeCss = styles['app-chrome.css'];

const rowsRule = chromeCss.match(/\.recent-pages\s+a:hover\s*\{([^}]*)\}/);

test('the recent-pages rows have a hover state with the menu-item tint', () => {
  assert.ok(rowsRule, 'expected .recent-pages a:hover');
  assert.match(rowsRule[1], /background:\s*#e8eefb/);
});

test('the recent-pages hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rowsRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(rowsRule[1]), 'hover must change background only');
});

test('the recent-pages resting rule keeps the transparent base the hover replaces', () => {
  const base = chromeCss.match(/\.recent-pages\s+a\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the .recent-pages a base rule');
  assert.ok(!/background:/.test(base[1]), 'base rule must not set a background');
});

defineHoverCases('recent-pages hover', {
  html: `<ul class="recent-pages"><li><a href="#/home" id="a">Home</a></li><li><a href="#/data" id="b">Data</a></li></ul>`,
  cases: [
    {
      target: '#a',
      rule: '.recent-pages a:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
    },
  ],
});
