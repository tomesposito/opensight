import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 106: hover feedback for the data-prep step
// editor's field labels (.prep-step-editor label in
// PrepStepEditor.tsx — the "Step name (optional)" label, the
// left-input label, and the Select/Text helper labels inside the
// step fieldsets: "Column", "New type", "New name", "Value",
// "Output name", "Expression", "Values (one per line)", all inside
// form.prep-step-editor in section.prep-configure in section.data-prep).
// The .data-prep label rule lays them out as a column flex (text
// line, gap, field), so the label has real visible area, but it had
// zero hover feedback: every label :hover rule in the cascade is
// scoped elsewhere (author toggles, parameter/action editors,
// O-mode notice, admin dialog, connector/sign-in/collection labels,
// and the slice-103/104/105 prep-columns, prep-key-column and
// prep-document-bar labels), so the label rested transparent and
// hovering its text or gap changed nothing, while only the field
// inside it tinted via the slice-31 select hover and the slice-39
// input/textarea hovers. A CSSOM probe with all five real
// stylesheets (1,364 rules) in the real ancestor contexts
// (standalone .data-prep and inside .app-shell) confirmed zero
// matching :hover rules for the step-name, left-input, fieldset and
// textarea labels and a transparent rest in both. The labels now
// take #e8eefb, the data-prep surface's established hover tint (the
// slice-31 select hover, the slice-39 button and input/textarea
// hovers, and the slice-103/104/105 prep label hovers), so no new
// colour is introduced. The column-picker row labels nested in the
// editor keep the identical tint via slice 103, and the key-column
// labels via slice 104. Background only, so resting geometry is
// identical and there is no animation. The data-prep surface is
// fixed light, so no dark variant.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.prep-step-editor label:hover\s*\{([^}]*)\}/m);

test('the prep-step-editor label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .prep-step-editor label :hover rule');
  assert.match(rule[1], /background:\s*#e8eefb/);
});

test('the hover tint matches the data-prep select and prep-columns hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-prep select hover must remain #e8eefb');
  assert.ok(styleCss.match(/\.prep-columns label:hover\s*\{[^}]*background:\s*#e8eefb/), 'the prep-columns label hover must remain #e8eefb');
});

test('the prep-step-editor label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting prep-step-editor and data-prep label rules are preserved and the fixed-light prep surface gains no dark variant', () => {
  assert.ok(styleCss.match(/\.prep-step-editor > label, \.prep-step-editor fieldset > label\s*\{[^}]*margin-bottom:\s*10px/), 'the prep-step-editor label resting rule must remain');
  assert.ok(styleCss.match(/\.data-prep label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/), 'the data-prep label resting rule must remain');
  assert.ok(!/data-chrome=dark[^\n]*prep-step-editor/.test(styleCss), 'the fixed-light data-prep surface must not gain a dark variant for this rule');
});

defineHoverCases('prep-step-editor-label hover', {
  html: `<section class="data-prep"><div class="prep-workspace"><div class="prep-main"><section class="prep-configure">`
      + `<form class="prep-step-editor"><h3>Rename column</h3>`
      + `<label id="stepNameLabel">Step name (optional)<input type="text"></label>`
      + `<fieldset><legend>Condition 1 (AND)</legend><label id="fieldsetLabel">Column<select><option>revenue</option></select></label></fieldset>`
      + `<label id="exprLabel">Expression<textarea rows="5"></textarea></label>`
      + `</form>`
      + `<div class="prep-input-config"><label id="pickerLabel">Connected source<select><option>Sales</option></select></label></div>`
      + `</section></div></div></section>`
      + `<div class="prep-document-bar"><label id="docLabel">Dataset name<input type="text"></label></div>`,
  cases: [
    {
      target: '#stepNameLabel',
      rule: '.prep-step-editor label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#pickerLabel', '#docLabel'],
    },
    {
      target: '#fieldsetLabel',
      rule: '.prep-step-editor label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#exprLabel',
      rule: '.prep-step-editor label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
