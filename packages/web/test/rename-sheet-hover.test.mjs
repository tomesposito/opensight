import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 118: hover feedback for the rename-sheet
// form's label and input (.rename-sheet label / input — "Sheet
// name" in SheetTabs in Author.tsx, shown in the sheet toolbar
// when renaming a sheet). The shared resting rule (.author-layout
// label, .analysis-title, .rename-sheet label, .calculation-dialog
// label) lays the label out as a column flex (text line, 4px gap,
// field), so the label is itself a visible surface, but both the
// label and its input had zero hover feedback: the form's buttons
// hover via .author-workspace button:hover, but the input sits
// outside .author-layout so the author field hovers never reach
// it (the workspace-wide input hovers cover only [type=color] and
// [type=search]), and every label :hover rule in the cascade is
// scoped elsewhere (property-section, parameter-editor,
// sheet-controls, calculation/analysis-file dialogs, O-mode
// notice, connector/sign-in/collection labels, the data-prep
// label series, the change-type label, the admin labels, the
// embed labels). A CSSOM probe with all five real stylesheets
// (1,381 rules) in the real ancestor contexts (author-workspace >
// author-center > sheet-toolbar > form.rename-sheet, light and
// dark chrome) confirmed zero matching :hover rules for both the
// label and the input and a transparent label rest in both
// chromes. The label and input now take #edf7f7, the author
// surface's established hover tint (the author button, field and
// summary hovers and the slices 112-117 label hovers), plus the
// author dark-chrome variant #334c62, so no new colour is
// introduced — and because the label and the field inside it take
// the same tint, hovering either reads as one surface, not two
// steps. Background only, so resting geometry is identical and
// there is no animation.
const styleCss = styles['style.css'];

const labelRule = styleCss.match(/^\.rename-sheet label:hover\s*\{([^}]*)\}/m);
const labelDarkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.rename-sheet label:hover\s*\{([^}]*)\}/m);
const inputRule = styleCss.match(/^\.rename-sheet input:hover:not\(:disabled\)\s*\{([^}]*)\}/m);
const inputDarkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.rename-sheet input:hover:not\(:disabled\)\s*\{([^}]*)\}/m);
const allRules = [labelRule, labelDarkRule, inputRule, inputDarkRule];

test('the rename-sheet label and input hover rules exist and use the established hover tints', () => {
  assert.ok(labelRule, 'expected the rename-sheet label :hover rule');
  assert.match(labelRule[1], /background:\s*#edf7f7/);
  assert.ok(inputRule, 'expected the rename-sheet input :hover rule');
  assert.match(inputRule[1], /background:\s*#edf7f7/);
  assert.ok(labelDarkRule, 'expected the author dark-chrome rename-sheet label :hover variant');
  assert.match(labelDarkRule[1], /background:\s*#334c62/);
  assert.ok(inputDarkRule, 'expected the author dark-chrome rename-sheet input :hover variant');
  assert.match(inputDarkRule[1], /background:\s*#334c62/);
});

test('the hover tints match the author field and label hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
  assert.ok(styleCss.match(/^\.property-section label:hover\s*\{[^}]*background:\s*#edf7f7/m), 'the slice-116 property-section label hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-layout input:hover:not\(:disabled\):not\(\[type=radio\]\)[^{]*\{[^}]*background:\s*#edf7f7/), 'the author field hover must remain #edf7f7');
  assert.ok(styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.property-section label:hover\s*\{[^}]*background:\s*#334c62/m), 'the slice-116 dark label hover must remain #334c62');
});

test('the rename-sheet hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  for (const r of allRules) {
    assert.ok(r, 'expected all four hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting rename-sheet and shared label rules are preserved', () => {
  assert.ok(styleCss.match(/\.author-layout label, \.analysis-title, \.rename-sheet label, \.calculation-dialog label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*4px[^}]*margin-bottom:\s*8px/), 'the shared resting label rule must remain');
  assert.ok(styleCss.match(/\.rename-sheet\s*\{[^}]*flex-basis:\s*100%[^}]*display:\s*flex/), 'the rename-sheet form resting rule must remain');
  assert.ok(styleCss.match(/\.rename-sheet label\s*\{[^}]*margin:\s*0/), 'the rename-sheet label resting rule must remain');
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\)/), 'the author button hover for the form buttons must remain');
});

const ctx = (id, dark) => `<div class="author-workspace" ${dark ? 'data-chrome="dark"' : ''}><div class="author-center"><div class="sheet-toolbar">`
      + `<form class="rename-sheet"><label id="${id}Label">Sheet name<input id="${id}Input" value="Sheet 1"/></label>`
      + `<button type="submit">Save name</button><button type="button">Cancel</button></form>`
      + `</div></div></div>`;

defineHoverCases('rename-sheet hover', {
  html: `` + ctx('l', false) + ctx('d', true)
      + `<label id="outsideLabel">Outside<input id="outsideInput"/></label>`,
  cases: [
    {
      target: '#lLabel',
      rule: '.rename-sheet label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel', '#outsideInput'],
    },
    {
      target: '#dLabel',
      rule: '.author-workspace[data-chrome="dark"] .rename-sheet label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lInput',
      rule: '.rename-sheet input:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dInput',
      rule: '.author-workspace[data-chrome="dark"] .rename-sheet input:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(32, 46, 64)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
