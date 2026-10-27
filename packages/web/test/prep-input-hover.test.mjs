import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 39: hover feedback for the data-prep inputs and
// textareas. A fresh behavioral hover audit of the preparation surface
// (real mouse hover + computed-style delta, Chromium, demo route) found
// the document-bar dataset-name input (280x28) and the steps-panel
// "Search steps" input (183x30) measured white -> white: the surface
// gives its buttons (and, since slice 31, its selects) a hover tint, but
// inputs and textareas — the remaining members of the resting-rule group
// (.data-prep input, .data-prep select, .data-prep textarea) — had none.
// The step editors' text inputs and expression/values textareas share the
// same resting rule and the same gap. They now take the surface's own
// hover tint (#edf6fc). Background only, so resting geometry is
// identical; disabled fields keep their flat state. Static (no
// animation), so no reduced-motion variant is needed.
const css = styles['style.css'];

const hoverRule = css.match(/\.data-prep\s+input:hover:not\(:disabled\),\s*\.data-prep\s+textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the prep input/textarea hover rule exists and uses the data-prep hover tint', () => {
  assert.ok(hoverRule, 'expected .data-prep input:hover:not(:disabled), .data-prep textarea:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#edf6fc/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the prep input/textarea hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting prep input/select/textarea rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.data-prep input, \.data-prep select, \.data-prep textarea \{([^}]*)\}/);
  assert.ok(resting, 'expected the shared .data-prep input/select/textarea resting rule');
  assert.match(resting[1], /background:\s*white/);
  assert.match(resting[1], /border:\s*1px solid #aebdca/);
  assert.match(resting[1], /padding:\s*7px/);
});

test('the prep input/textarea hover rule coexists with the prep button and select hover rules', () => {
  assert.ok(css.match(/\.data-prep\s+button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep button hover rule must still be present');
  assert.ok(css.match(/\.data-prep\s+select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the slice-31 data-prep select hover rule must still be present');
  assert.ok(hoverRule, 'expected the prep input/textarea hover rule');
});

defineHoverCases('prep-input hover', {
  html: `<div class="data-prep"><div class="prep-document-bar"><label>Dataset name<input id="name" value="demo"></label></div><div class="prep-sidebar"><label class="prep-steps-search">Search steps<input id="search" type="search" placeholder="Search steps"></label></div><label>Expression<textarea id="expr" rows="3">{revenue}</textarea></label><label>Locked<input id="locked" disabled value="x"></label></div>`,
  cases: [
    {
      target: '#name',
      rule: '.data-prep input:hover:not(:disabled), .data-prep textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 246, 252)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#locked'],
    },
    {
      target: '#search',
      rule: '.data-prep input:hover:not(:disabled), .data-prep textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 246, 252)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#expr',
      rule: '.data-prep input:hover:not(:disabled), .data-prep textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 246, 252)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
