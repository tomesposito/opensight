import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 21: hover feedback for the Data landing's dataset
// filter select. A fresh interactive-state audit of the landing surfaces
// (home/analyses/dashboards/data, in-page CLS at 0 on every route, no page
// errors) found the filter select was the last interactive control on the
// data surface with zero hover state: hovering it changed nothing, while the
// surrounding buttons and tabs already take the data page's established
// menu-item hover tint (#eaf3f7, slice 16). The select takes the same tint;
// disabled selects (e.g. the dataset-permissions select) keep their flat
// state. Background only, so resting geometry is identical. Static (no
// animation), so no reduced-motion variant is needed.
const css = styles['data-section.css'];

const hoverRule = css.match(/\.data-page\s+select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the data-page filter select has a hover state using the menu tint', () => {
  assert.ok(hoverRule, 'expected .data-page select:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected .data-page select:hover:not(:disabled)');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting select rule still reserves the geometry the hover keeps', () => {
  const matches = [...css.matchAll(/([^{}]*\.data-page\s+select[^{}]*)\{([^}]*)\}/g)]
    .filter(([, selector]) => !selector.includes(':'));
  assert.ok(matches.length, 'expected a non-pseudo .data-page select rule');
  const resting = matches.find(([, , body]) => /border:\s*1px\s+solid\s+#9eb0ba/.test(body));
  assert.ok(resting, 'expected the base rule with the resting border');
  assert.match(resting[2], /background:\s*white/);
});

defineHoverCases('data-filter-select hover', {
  html: `<section class="data-page"><div class="data-tools"><select aria-label="Filter datasets"><option value="all">All datasets</option><option value="cached">Cached datasets</option></select><select aria-label="Disabled filter" disabled><option>Owner</option></select></div></section>`,
  cases: [
    {
      target: '.data-page select:not([disabled])',
      rule: '.data-page select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      excluded: [{ target: '.data-page select[disabled]', resting: { backgroundColor: 'rgb(255, 255, 255)' } }],
    },
  ],
});
