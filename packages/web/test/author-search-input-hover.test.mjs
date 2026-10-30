import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 38: hover feedback for the author-workspace search
// input (the Data panel's "Search fields" field in the builder panel). The
// author hover rules cover buttons, selects (slice 36) and color inputs
// (slice 37), so the field search had zero hover state: a behavioral audit
// with every property section expanded (real mouse hover, :hover and
// hit-test confirmed) measured white -> white on it, the largest real
// zero-hover control left on the author surface. The audit's only other real
// hits are single native controls judged standard no-hover by design: a
// 13x13 favorites checkbox (as in slice 33) and the bundle import's
// OS-rendered file input. The search input now takes the author buttons'
// hover tint (#eef3fd); dark chrome takes the dark button hover background
// (#36486a) via a more specific variant, as in slices 36/37. Paint-only: the
// rules change background only, so resting geometry is identical and there
// is no animation to need a reduced-motion variant.
const styleCss = styles['style.css'];

const lightRule = styleCss.match(/\.author-workspace\s+input\[type=search\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const darkRule = styleCss.match(/\.author-workspace\[data-chrome=dark\]\s+input\[type=search\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('author-workspace search inputs have a hover state with the author button tint', () => {
  assert.ok(lightRule, 'expected .author-workspace input[type=search]:hover:not(:disabled)');
  assert.match(lightRule[1], /background:\s*#eef3fd/);
});

test('dark chrome search inputs take the dark button hover background', () => {
  assert.ok(darkRule, 'expected .author-workspace[data-chrome=dark] input[type=search]:hover:not(:disabled)');
  assert.match(darkRule[1], /background:\s*#36486a/);
});

test('the search-input hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [lightRule, darkRule]) {
    assert.ok(rule, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(rule[1]), 'hover must change background only');
  }
});

test('the resting author input rule is preserved', () => {
  const resting = styleCss.match(/\.author-layout\s+input:not\(\[type=checkbox\]\)[^{]*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .author-layout input resting rule to remain');
  assert.match(resting[1], /border:\s*1px solid #c3cfe0/);
  assert.match(resting[1], /padding:\s*5px 6px/);
});

test('the search-input hover rules coexist with the slice-36/37 author hover rules', () => {
  assert.ok(styleCss.match(/\.author-workspace\s+select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'slice-36 select rule must still be present');
  assert.ok(styleCss.match(/\.author-workspace\s+input\[type=color\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'slice-37 color-input rule must still be present');
});

defineHoverCases('author-search-input hover', {
  html: `<div class="author-workspace"><div class="author-layout"><details class="builder-panel fields-panel" open><div class="panel-content">`
      + `<label>Search fields<input type="search" id="s" placeholder="Search fields"></label>`
      + `</div></details></div></div>`,
  cases: [
    {
      target: '#s',
      rule: '.author-workspace input[type="search"]:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['borderTopColor'],
    },
  ],
});
