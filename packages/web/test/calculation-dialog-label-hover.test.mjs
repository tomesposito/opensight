import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 117: hover feedback for the Calculated
// field dialog's field labels (.calculation-dialog label — "Name",
// "Use as", "Expression" and "Function reference" in
// CalculationDialog in Author.tsx). The shared resting rule
// (.author-layout label, .analysis-title, .rename-sheet label,
// .calculation-dialog label) lays these labels out as column
// flexes (text line, 4px gap, field), so each label is itself a
// visible surface, but the labels had zero hover feedback: slice
// 46 hovered the dialog's buttons and fields and slice 68 its
// "Build for me" summary, while every label :hover rule in the
// cascade is scoped elsewhere (property-section, parameter-editor,
// sheet-controls, action lists, O-mode notice,
// connector/sign-in/collection labels, the data-prep label series,
// the change-type label, the admin labels, the embed labels), so
// the labels rested transparent and hovering their text or gap
// changed nothing, while only the field inside each label tinted
// via the slice-46 field hovers. The dialog renders outside
// .author-workspace (a sibling of it in Author.tsx), so the author
// label hovers never reach it either. The labels now take
// #edf7f7, the dialog's own established hover tint (slice 46's
// button, field and summary hovers in this same dialog), so no
// new colour is introduced — and because the inner field's own
// hover is the same tint, hovering the field inside the label
// reads as one surface, not two steps. The dialog's resting
// colors are fixed light (it has no dark-chrome variant), so no
// dark variant is added. Background only, so resting geometry is
// identical and there is no animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.calculation-dialog label:hover\s*\{([^}]*)\}/m);

test('the calculation-dialog label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the calculation-dialog label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint matches the slice-46 dialog field hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.calculation-dialog input:hover:not\(:disabled\), \.calculation-dialog select:hover:not\(:disabled\), \.calculation-dialog textarea:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-46 dialog field hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.calculation-dialog \.o-build-for-me summary:hover\s*\{[^}]*background:\s*#edf7f7/), 'the slice-68 dialog summary hover must remain #edf7f7');
});

test('the calculation-dialog label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting shared label rule and the slice-46/68 dialog hover rules are preserved', () => {
  assert.ok(styleCss.match(/\.author-layout label, \.analysis-title, \.rename-sheet label, \.calculation-dialog label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*4px[^}]*margin-bottom:\s*8px/), 'the shared resting label rule must remain');
  assert.ok(styleCss.match(/\.calculation-dialog button:hover:not\(:disabled\)/), 'the slice-46 dialog button hover must remain');
  assert.ok(styleCss.match(/\.calculation-dialog \{[^}]*padding:\s*24px/), 'the dialog resting rule must remain');
});

defineHoverCases('calculation-dialog-label hover', {
  html: `<dialog class="calculation-dialog" open><form><h2>Calculated field</h2>`
      + `<label id="nameLabel">Name<input value="x"/></label>`
      + `<label id="roleLabel">Use as<select><option>Measure (number)</option></select></label>`
      + `<label id="exprLabel">Expression<textarea rows="5"></textarea></label>`
      + `<label id="fnLabel">Function reference<select><option>concat</option></select></label>`
      + `</form></dialog>`
      + `<label id="outsideLabel">Outside<input/></label>`,
  cases: [
    {
      target: '#nameLabel',
      rule: '.calculation-dialog label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel'],
    },
    {
      target: '#roleLabel',
      rule: '.calculation-dialog label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#exprLabel',
      rule: '.calculation-dialog label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#fnLabel',
      rule: '.calculation-dialog label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
