import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 105: hover feedback for the data-prep
// document bar's field labels (.prep-document-bar > label in
// DataPrep.tsx — "Dataset name" wrapping its text input and "Saved
// datasets" wrapping its select, both direct children of
// div.prep-document-bar in section.data-prep). The .data-prep label
// rule lays them out as a column flex (text line, gap, field), so the
// label has real visible area, but it had zero hover feedback: every
// label :hover rule in the cascade is scoped elsewhere (author
// toggles, parameter/action editors, O-mode notice, admin dialog,
// connector/sign-in/collection labels, and the slice-103/104
// prep-columns and prep-key-column labels), so the label rested
// transparent and hovering its text or gap changed nothing, while
// only the field inside it tinted via the slice-31 select hover and
// the slice-39 input hover. A CSSOM probe with all five real
// stylesheets in the real ancestor contexts (standalone .data-prep
// and inside .app-shell) confirmed zero matching :hover rules for
// both labels and a transparent rest in both. The labels now take
// #e8eefb, the data-prep surface's established hover tint (the
// slice-31 select hover, the slice-39 button and input/textarea
// hovers, and the slice-103/104 prep label hovers), so no new colour
// is introduced. Background only, so resting geometry is identical
// and there is no animation. The data-prep surface is fixed light,
// so no dark variant.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.prep-document-bar > label:hover\s*\{([^}]*)\}/m);

test('the prep-document-bar label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .prep-document-bar > label :hover rule');
  assert.match(rule[1], /background:\s*#e8eefb/);
});

test('the hover tint matches the data-prep select and prep-columns hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-prep select hover must remain #e8eefb');
  assert.ok(styleCss.match(/\.prep-columns label:hover\s*\{[^}]*background:\s*#e8eefb/), 'the prep-columns label hover must remain #e8eefb');
});

test('the prep-document-bar label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting prep-document-bar and data-prep label rules are preserved and the fixed-light prep surface gains no dark variant', () => {
  assert.ok(styleCss.match(/\.prep-document-bar\s*\{[^}]*background:\s*#edf2f6/), 'the prep-document-bar resting rule must remain');
  assert.ok(styleCss.match(/\.data-prep label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/), 'the data-prep label resting rule must remain');
  assert.ok(!/data-chrome=dark[^\n]*prep-document-bar/.test(styleCss), 'the fixed-light data-prep surface must not gain a dark variant for this rule');
});

defineHoverCases('prep-document-bar-label hover', {
  html: `<section class="data-prep"><div class="prep-document-bar">`
      + `<label id="docLabel">Dataset name<input type="text"></label>`
      + `<div class="prep-actions"><label id="nestedLabel">Nested<input type="text"></label></div>`
      + `</div><form class="prep-step-editor"><label id="outsideLabel">Step name (optional)<input type="text"></label></form></section>`,
  cases: [
    {
      target: '#docLabel',
      rule: '.prep-document-bar > label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#nestedLabel', '#outsideLabel'],
    },
  ],
});
