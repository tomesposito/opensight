import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 27: hover feedback for the Data landing's dataset
// search input. A fresh interactive-state audit of the landing surfaces
// (home/my-stuff/analyses/dashboards/data, in-page CLS at 0 on every route,
// no page errors) found the search input was the last interactive control on
// the landing surfaces with zero hover state: hovering it changed nothing,
// while the surrounding buttons, tabs, and the filter select already take the
// data page's established menu-item hover tint (#e8eefb, slices 16/21). The
// input takes the same tint; disabled inputs keep their flat state. Background
// only, so resting geometry is identical. Static (no animation), so no
// reduced-motion variant is needed.
const css = styles['data-section.css'];

const hoverRule = css.match(/\.data-page\s+input\[type=search\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the data-page search input has a hover state using the menu tint', () => {
  assert.ok(hoverRule, 'expected .data-page input[type=search]:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#e8eefb/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected .data-page input[type=search]:hover:not(:disabled)');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting search-input rule still reserves the geometry the hover keeps', () => {
  const matches = [...css.matchAll(/([^{}]*\.data-page\s+input[^{}]*)\{([^}]*)\}/g)]
    .filter(([, selector]) => !selector.includes(':'));
  assert.ok(matches.length, 'expected a non-pseudo .data-page input rule');
  const resting = matches.find(([, , body]) => /border:\s*1px\s+solid\s+#9eb0ba/.test(body));
  assert.ok(resting, 'expected the base rule with the resting border');
  assert.match(resting[2], /background:\s*white/);
});

test('the data-page search input hover rule coexists with the filter select rule', () => {
  assert.ok(css.match(/\.data-page\s+select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'slice-21 filter select rule must still be present');
  assert.ok(hoverRule, 'expected .data-page input[type=search]:hover:not(:disabled)');
});

defineHoverCases('data-search-input hover', {
  html: `<section class="data-page"><div class="data-tools"><input type="search" aria-label="Search datasets by name" placeholder="Search datasets by name"><input type="search" aria-label="Disabled search" disabled></div></section>`,
  cases: [
    {
      target: '.data-page input:not([disabled])',
      rule: '.data-page input[type="search"]:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      excluded: [{ target: '.data-page input[disabled]', resting: { backgroundColor: 'rgb(255, 255, 255)' } }],
    },
  ],
});
