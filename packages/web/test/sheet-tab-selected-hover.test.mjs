import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 29: hover feedback for the selected sheet tab.
// A fresh behavioral hover audit of the landing surfaces
// (home/my-stuff/analyses/dashboards/data — real mouse hover with
// computed-style delta measurement) found the selected sheet tab (the home
// "Overview" tab, aria-current="page") was the last interactive control on
// the landing surfaces with zero hover feedback: hovering it changed nothing.
// Slice 18's rule deliberately excluded the selected tab; the selected tab
// now takes the #e8eefb menu-item tint on hover (the slice-28
// selected-data-tab language), so it reads interactive while staying visually
// distinct at rest (teal text + underline unchanged). Background only, so
// resting geometry is identical; disabled tabs keep their flat state. Static
// (no animation), so no reduced-motion variant is needed.
const css = styles['style.css'];

const hoverRule = css.match(/\.sheet-tabs\s+button\[aria-current\]:hover:not\(:disabled\),\s*\.sheet-tabs\s+button\[aria-selected=true\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the selected sheet tab has a hover state using the menu tint', () => {
  assert.ok(hoverRule, 'expected .sheet-tabs button[aria-current]:hover:not(:disabled), .sheet-tabs button[aria-selected=true]:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#e8eefb/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the selected sheet-tab hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting selected-tab rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.sheet-tabs\s+button\[aria-current\]\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .sheet-tabs button[aria-current] resting rule');
  assert.match(resting[1], /color:\s*#2f66d8/);
  assert.match(resting[1], /border-color:\s*#3b82f6/);
});

test('the selected-tab hover rule coexists with the unselected-tab hover rule', () => {
  assert.ok(css.match(/\.sheet-tabs\s+button:hover:not\(\[aria-current\]\):not\(\[aria-selected=true\]\)\s*\{[^}]*color:\s*#2f66d8/), 'the unselected-tab hover rule (slice 18) must still be present');
  assert.ok(hoverRule, 'expected the selected sheet-tab hover rule');
});

defineHoverCases('sheet-tab-selected hover', {
  html: `<div class="sheet-tabs"><button type="button" aria-current="page">Overview<span>5 visuals</span></button><button type="button" aria-selected="true">Sheet 2</button><button type="button" aria-current="page" disabled>Archived</button></div>`,
  cases: [
    {
      target: '.sheet-tabs button[aria-current=page]:not([disabled])',
      rule: '.sheet-tabs button[aria-current]:hover:not(:disabled), .sheet-tabs button[aria-selected="true"]:hover:not(:disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['.sheet-tabs button[aria-current=page][disabled]'],
    },
    {
      target: '.sheet-tabs button[aria-selected=true]',
      rule: '.sheet-tabs button[aria-selected=true]:hover:not(:disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color', 'borderBottomColor'],
    },
  ],
});
