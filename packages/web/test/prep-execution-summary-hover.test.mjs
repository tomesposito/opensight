import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 41: hover feedback for the data-prep
// "Dataset execution" disclosure summary. Slice 40's behavioral hover
// audit (real mouse hover + computed-style delta, Chromium, demo routes)
// left exactly one noted lead on the data-prep surface: the
// .prep-execution summary ("Dataset execution · mode, refresh and cached
// output") measured transparent -> transparent while every button,
// select, input and textarea around it tinted (slices 31/39). It already
// has the pointer cursor, the global focus outline and the slice-15
// :active press; hover was the missing state. It now takes the data-prep
// surface's own hover tint (#edf6fc, the buttons/selects/inputs
// language). Background only, so resting geometry is identical. Static
// (no animation), so no reduced-motion variant is needed.
const css = styles['style.css'];

const hoverRule = css.match(/\.prep-execution\s+summary:hover\s*\{([^}]*)\}/);

test('the prep-execution summary hover rule exists and uses the data-prep tint', () => {
  assert.ok(hoverRule, 'expected .prep-execution summary:hover');
  assert.match(hoverRule[1], /background:\s*#edf6fc/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the prep-execution summary hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting prep-execution rules still reserve the geometry the hover keeps', () => {
  const block = css.match(/\.prep-execution \{([^}]*)\}/);
  assert.ok(block, 'expected the .prep-execution resting rule');
  assert.match(block[1], /margin:\s*8px 0/);
  const summary = css.match(/\.prep-execution summary \{([^}]*)\}/);
  assert.ok(summary, 'expected the .prep-execution summary resting rule');
  assert.match(summary[1], /cursor:\s*pointer/);
});

test('the prep-execution summary hover rule coexists with the other summary states', () => {
  assert.ok(css.match(/\.card-footer\s+summary:hover/), 'the card-footer summary hover rule must still be present');
  assert.ok(css.match(/summary:active\s*\{[^}]*transform:\s*translateY\(1px\)/), 'the global summary :active press must still be present');
  assert.ok(css.match(/summary:focus-visible/), 'the global summary focus-visible outline must still be present');
  assert.ok(hoverRule, 'expected the prep-execution summary hover rule');
});

defineHoverCases('prep-execution-summary hover', {
  html: `<section class="data-prep"><details class="prep-execution"><summary id="exec">Dataset execution · mode, refresh and cached output</summary></details></section><details><summary id="outside">Outside summary</summary></details>`,
  cases: [
    {
      target: '#exec',
      rule: '.prep-execution summary:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 246, 252)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outside'],
    },
  ],
});
