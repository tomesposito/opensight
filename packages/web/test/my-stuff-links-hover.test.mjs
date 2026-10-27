import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 25: hover feedback for the my-stuff collection
// quick links. A fresh interactive-state audit of the landing surfaces found
// `nav.my-stuff-links a` ("My analyses", "Dashboards", "My folders", "Shared
// folders") was the last control class with zero hover state: hovering them
// changed nothing. They take the app-wide menu-item hover tint (#eaf3f7,
// slices 16/21). Paint-only: the rule changes the background, so resting
// geometry is identical and there is no animation to need a reduced-motion
// variant.
const chromeCss = styles['app-chrome.css'];

const linksRule = chromeCss.match(/\.my-stuff-links\s+a:hover\s*\{([^}]*)\}/);

test('the my-stuff quick links have a hover state with the menu-item tint', () => {
  assert.ok(linksRule, 'expected .my-stuff-links a:hover');
  assert.match(linksRule[1], /background:\s*#eaf3f7/);
});

test('the quick-link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(linksRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(linksRule[1]), 'hover must change background only');
});

test('the quick-link resting rule keeps the transparent base the hover replaces', () => {
  const base = chromeCss.match(/\.my-stuff-links\s+a\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the .my-stuff-links a base rule');
  assert.ok(!/background:/.test(base[1]), 'base rule must not set a background');
});

defineHoverCases('my-stuff-links hover', {
  html: `<nav class="my-stuff-links"><a href="#/analyses" id="a">My analyses</a><a href="#/dashboards" id="b">Dashboards</a></nav>`,
  cases: [
    {
      target: '#a',
      rule: '.my-stuff-links a:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
    },
  ],
});
