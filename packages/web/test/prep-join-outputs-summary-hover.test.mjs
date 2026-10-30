import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 69: hover feedback for the data-prep join
// editor's "Right output columns" disclosure summary. Every other
// data-prep control hovers to the surface tint (#e8eefb): buttons,
// selects, inputs and textareas via the .data-prep rules, and the
// prep-execution disclosure summary via slice 41. The join outputs
// summary (.prep-join-outputs summary in PrepJoinEditor.tsx) is none
// of those elements, so no hover rule reached it — its only rule gave
// the pointer cursor and a bottom margin — and hovering it changed
// nothing while every other control in the join editor tinted. It
// only renders while a join step is being configured, so route audits
// never reach it. It now takes the data-prep surface's own hover tint
// (#e8eefb). Background only, so resting geometry is identical and
// there is no animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/\.prep-join-outputs\s+summary:hover\s*\{([^}]*)\}/);

test('the prep-join-outputs summary has a hover state with the data-prep tint', () => {
  assert.ok(rule, 'expected the .prep-join-outputs summary hover rule');
  assert.match(rule[1], /background:\s*#e8eefb/);
});

test('the summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting prep-join-outputs rules are preserved', () => {
  assert.ok(styleCss.match(/\.prep-join-outputs summary\s*\{[^}]*cursor:\s*pointer; margin-bottom:\s*8px/), 'the summary resting rule must remain');
  assert.ok(styleCss.match(/\.prep-join-outputs label\s*\{[^}]*margin-bottom:\s*8px/), 'the outputs label resting rule must remain');
});

test('the neighbouring data-prep hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.data-prep button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-prep button hover must remain');
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-prep select hover must remain');
  assert.ok(styleCss.match(/\.data-prep input:hover:not\(:disabled\), \.data-prep textarea:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-prep field hover must remain');
  assert.ok(styleCss.match(/\.prep-execution summary:hover\s*\{[^}]*background:\s*#e8eefb/), 'slice 41 prep-execution summary hover must remain');
});

defineHoverCases('prep-join-outputs-summary hover', {
  html: `<section class="data-prep"><div class="prep-join-settings"><details class="prep-join-outputs"><summary id="s">Right output columns</summary></details></div></section>`
      + `<details><summary id="outside">Outside summary</summary></details>`,
  cases: [
    {
      target: '#s',
      rule: '.prep-join-outputs summary:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      excluded: ['#outside'],
    },
  ],
});
