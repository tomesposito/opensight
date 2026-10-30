import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 109: hover feedback for the author build
// panel's "Change visual type" label (label.change-type in
// Author.tsx — text + select inside .visual-config in the
// .build-panel Panel in .author-layout in .author-workspace).
// The .author-layout label rule lays it out as a column flex
// (text line, gap, field), so the label has real visible area,
// but it had zero hover feedback: every label :hover rule in the
// cascade is scoped elsewhere (author toggles, parameter/action
// editor checkbox and radio labels, the O-mode notice label,
// admin dialog labels, connector/sign-in/collection labels, and
// the data-prep label series), so the label rested transparent
// in both chrome modes and hovering its text or gap changed
// nothing, while only the select inside it tinted via the author
// select hover. This was the fresh zero-hover audit on a new
// surface left by slice 108. The label now takes #eef3fd (light)
// / #36486a (dark chrome), the author surface's established
// hover tints (the author select hover and the slice-97 toggle
// label hover), so no new colour is introduced. Background
// only, so resting geometry is identical and there is no
// animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.change-type:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.change-type:hover\s*\{([^}]*)\}/m);

test('the change-type label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .change-type :hover rule');
  assert.match(rule[1], /background:\s*#eef3fd/);
});

test('the hover tint matches the author select and toggle-label hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the author select hover must remain #eef3fd');
  assert.ok(styleCss.match(/^label\.toggle:hover\s*\{[^}]*background:\s*#eef3fd/m), 'the toggle label hover must remain #eef3fd');
});

test('the change-type label hover rules are paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(darkRule, 'expected the dark hover rule');
  for (const r of [rule, darkRule]) assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
});

test('the dark variant uses the author dark hover tint and the resting change-type and author label rules are preserved', () => {
  assert.ok(darkRule, 'expected the dark .change-type :hover rule');
  assert.match(darkRule[1], /background:\s*#36486a/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#36486a/), 'the author dark select hover must remain #36486a');
  assert.ok(styleCss.match(/^\.change-type\s*\{[^}]*max-width:\s*230px/m), 'the change-type resting rule must remain');
  assert.ok(styleCss.match(/\.author-layout label, \.analysis-title, \.rename-sheet label, \.calculation-dialog label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/), 'the author label resting rule must remain');
});

const panel = (id, wellId) => `<details class="builder-panel build-panel" open><div class="panel-content">`
      + `<div class="visual-config"><h3>Field wells</h3>`
      + `<label class="change-type" id="${id}">Change visual type<select><option>Bar</option></select></label>`
      + `<div class="field-wells"><fieldset><label class="well-picker" id="${wellId}"><span class="sr-only">Assign rows</span><select><option>Choose field…</option></select></label></fieldset></div>`
      + `</div></div></details>`;

defineHoverCases('change-type-label hover', {
  html: `<div class="author-workspace" data-chrome="light"><div class="author-layout">${panel('changeLight', 'wellLight')}</div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout">${panel('changeDark', 'wellDark')}</div></div>`,
  cases: [
    {
      target: '#changeLight',
      rule: '.change-type:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#wellLight'],
    },
    {
      target: '#changeDark',
      rule: '.author-workspace[data-chrome="dark"] .change-type:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(54, 72, 106)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#wellDark'],
    },
  ],
});
