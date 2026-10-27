import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 115: hover feedback for the
// ParameterEditor's plain field labels (.parameter-editor label —
// "Parameter name" wrapping its text input, "Parameter type"
// wrapping its select, and "Default values" wrapping its textarea
// in ParameterEditor.tsx's create-parameter form, inside
// details.parameter-editor in the author Data panel). The shared
// resting rule lays these labels out as column flexes (text line,
// 4px gap, field), so each label is itself a visible surface, but
// the plain labels had zero hover feedback: slice 99 hovered only
// the editor's checkbox labels via :has(> input[type=checkbox]),
// and every other label :hover rule in the cascade is scoped
// elsewhere (author toggles, the sheet-controls labels of slices
// 112/113 — which share this resting rule and explicitly left the
// parameter-editor labels out as a different surface — the
// connector/sign-in/collection labels, the data-prep label series,
// the change-type label, the admin labels, the embed labels), so
// the labels rested transparent and hovering their text or gap
// changed nothing, while only the field inside each label tinted
// via the author field hovers. A CSSOM probe with all five real
// stylesheets (1,374 rules) in the real ancestor contexts
// (author-workspace > author-layout > builder-panel >
// parameter-editor, light and dark chrome) confirmed zero matching
// :hover rules for all three plain labels and a transparent rest
// in both chromes, while the checkbox labels matched the slice-99
// rules and the name/type/default fields matched the author field
// hovers. The labels now take #edf7f7, the author surface's
// established hover tint (the author button, field and summary
// hovers, the slice-99 checkbox-label hover in this same editor,
// and the slices 112/113 controls-label hovers sharing the resting
// rule), plus the author dark-chrome variant #334c62, so no new
// colour is introduced — and because the inner field's own hover
// is the same tint, hovering the field inside the label reads as
// one surface, not two steps. The slice-99 :has rules keep higher
// specificity with the same tints, so the checkbox labels are
// unchanged. Background only, so resting geometry is identical
// and there is no animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.parameter-editor label:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.parameter-editor label:hover\s*\{([^}]*)\}/m);

test('the parameter-editor plain label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the parameter-editor plain label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tints match the author field hovers and the slice-99 checkbox-label hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
  assert.ok(styleCss.match(/^\.parameter-editor label:has\(> input\[type=checkbox\]\):hover\s*\{[^}]*background:\s*#edf7f7/m), 'the slice-99 checkbox label hover must remain #edf7f7');
  assert.ok(darkRule, 'expected the author dark-chrome parameter-editor label :hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.parameter-editor label:has\(> input\[type=checkbox\]\):hover\s*\{[^}]*background:\s*#334c62/m), 'the slice-99 dark checkbox label hover must remain #334c62');
});

test('the parameter-editor label hover rules are paint-only: resting geometry and label presentation cannot shift', () => {
  for (const r of [rule, darkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting parameter-editor label rule and the slice-99 checkbox rules are preserved', () => {
  assert.ok(styleCss.match(/\.parameter-control label, \.control-settings label, \.control-form label, \.parameter-editor label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*4px[^}]*margin-bottom:\s*8px/), 'the shared resting label rule must remain');
  assert.ok(styleCss.match(/^\.parameter-editor label:has\(> input\[type=checkbox\]\):hover/m), 'the slice-99 checkbox label hover must remain');
});

const ctx = (id, dark) => `<div class="author-workspace" ${dark ? 'data-chrome="dark"' : ''}><div class="author-layout"><aside class="builder-panel">`
      + `<details class="parameter-editor" open><summary>Parameters</summary><form>`
      + `<label id="${id}Name">Parameter name<input value="x"/></label>`
      + `<label id="${id}Type">Parameter type<select><option>string</option></select></label>`
      + `<label id="${id}Check"><input type="checkbox"/>Multiple values</label>`
      + `<label id="${id}Def">Default values<textarea></textarea></label>`
      + `</form></details></aside></div></div>`;

defineHoverCases('parameter-editor-label hover', {
  html: `` + ctx('l', false) + ctx('d', true)
      + `<label id="outsideLabel">Outside<input/></label>`,
  cases: [
    {
      target: '#lName',
      rule: '.parameter-editor label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel'],
    },
    {
      target: '#lType',
      rule: '.parameter-editor label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lDef',
      rule: '.parameter-editor label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dName',
      rule: '.author-workspace[data-chrome="dark"] .parameter-editor label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dType',
      rule: '.author-workspace[data-chrome="dark"] .parameter-editor label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dDef',
      rule: '.author-workspace[data-chrome="dark"] .parameter-editor label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lCheck',
      rule: '.parameter-editor label:has(> input[type="checkbox"]):hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dCheck',
      rule: '.author-workspace[data-chrome="dark"] .parameter-editor label:has(> input[type="checkbox"]):hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
