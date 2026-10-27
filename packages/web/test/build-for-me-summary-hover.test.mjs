import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 68: hover feedback for the "Build for me"
// disclosure summary inside the Calculated field dialog. Slice 46
// gave the dialog (.calculation-dialog — a sibling outside
// .author-workspace, so the author hover rules never reach it) hover
// states for its buttons, primary button, inputs, selects and
// textareas, but the BuildForMe <details> summary (.o-build-for-me
// summary) is none of those: slice 42's summary hover rules are all
// scoped to .author-workspace, and the global summary rules give only
// cursor and an :active press, so hovering "Build for me" changed
// nothing while every other control in the same dialog tinted. It now
// takes the dialog's own hover tint (#edf7f7, slice 46's button/field
// tint). The dialog's resting colors are fixed light (no dark-chrome
// variant), so no dark variant is added. Background only, so resting
// geometry is identical and there is no animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/\.calculation-dialog\s+\.o-build-for-me\s+summary:hover\s*\{([^}]*)\}/);

test('the build-for-me summary has a hover state with the calculation dialog tint', () => {
  assert.ok(rule, 'expected the .calculation-dialog .o-build-for-me summary hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting build-for-me rules are preserved', () => {
  assert.ok(styleCss.match(/\.o-build-for-me\s*\{[^}]*border:\s*1px solid #a9c5d2/), 'the build-for-me resting frame must remain');
  assert.ok(styleCss.match(/\.o-build-for-me summary\s*\{[^}]*font-weight:\s*600; cursor:\s*pointer/), 'the summary resting rule must remain');
});

test('the neighbouring calculation-dialog hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.calculation-dialog button:hover:not\(:disabled\)\s*\{[^}]*border-color:\s*#157f88; background:\s*#edf7f7/), 'slice 46 button hover must remain');
  assert.ok(styleCss.match(/\.calculation-dialog \.primary-button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#126e76/), 'slice 46 primary hover must remain');
  assert.ok(styleCss.match(/\.calculation-dialog input:hover:not\(:disabled\), \.calculation-dialog select:hover:not\(:disabled\), \.calculation-dialog textarea:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'slice 46 field hover must remain');
});

test('the author-workspace summary hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.author-workspace \.builder-panel > summary:hover/), 'slice 42 summary hover must remain');
});

defineHoverCases('build-for-me-summary hover', {
  html: `<dialog class="calculation-dialog" open><form><details class="o-build-for-me"><summary id="s">Build for me</summary><p>Local deterministic templates</p></details></form></dialog>`
      + `<div class="author-workspace"><details class="o-build-for-me"><summary id="outside">Build for me</summary></details></div>`,
  cases: [
    {
      target: '#s',
      rule: '.calculation-dialog .o-build-for-me summary:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      excluded: ['#outside'],
    },
  ],
});
