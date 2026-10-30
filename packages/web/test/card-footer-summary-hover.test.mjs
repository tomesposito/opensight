import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 40: hover feedback for the visual-card footer
// "View data" summary. A fresh behavioral hover audit across the demo
// routes (real mouse hover + computed-style delta, Chromium) — the first
// audit whose selector set included <summary> — found the card footer's
// disclosure summary measured transparent -> transparent on the home and
// fixture-preview surfaces (545x17, hit-testable, :hover applied): other
// summaries already tint on hover (.account-menu, .author-menu,
// .data-menu), and this one already has the global cursor, focus outline
// and :active press, but no hover state at all. It now takes the landing
// surfaces' menu tint (#e8eefb). Background only, so resting geometry is
// identical. Static (no animation), so no reduced-motion variant is
// needed.
const css = styles['style.css'];

const hoverRule = css.match(/\.card-footer\s+summary:hover\s*\{([^}]*)\}/);

test('the card-footer summary hover rule exists and uses the landing menu tint', () => {
  assert.ok(hoverRule, 'expected .card-footer summary:hover');
  assert.match(hoverRule[1], /background:\s*#e8eefb/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the card-footer summary hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting card-footer rules still reserve the geometry the hover keeps', () => {
  const footer = css.match(/\.card-footer \{([^}]*)\}/);
  assert.ok(footer, 'expected the .card-footer resting rule');
  assert.match(footer[1], /padding:\s*0 20px/);
  assert.match(footer[1], /color:\s*#607784/);
  const details = css.match(/\.card-footer details \{([^}]*)\}/);
  assert.ok(details, 'expected the .card-footer details resting rule');
  assert.match(details[1], /padding:\s*9px 0/);
});

test('the card-footer summary hover rule coexists with the other summary states', () => {
  assert.ok(css.match(/\.author-menu summary:hover/), 'the author-menu summary hover rule must still be present');
  assert.ok(css.match(/summary:active\s*\{[^}]*transform:\s*translateY\(1px\)/), 'the global summary :active press must still be present');
  assert.ok(css.match(/summary:focus-visible/), 'the global summary focus-visible outline must still be present');
  assert.ok(hoverRule, 'expected the card-footer summary hover rule');
});

defineHoverCases('card-footer-summary hover', {
  html: `<div class="visual-card"><div class="card-footer"><details><summary id="view">View data · 1 row</summary></details></div></div><details><summary id="outside">Outside summary</summary></details>`,
  cases: [
    {
      target: '#view',
      rule: '.card-footer summary:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outside'],
    },
  ],
});
