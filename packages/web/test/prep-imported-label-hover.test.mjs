import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 112: hover feedback for the data-prep
// imported-dataset picker label (the bare <label> in DataPrep.tsx
// — "Imported dataset" wrapping its select, a direct child of
// section.data-prep, rendered only when an imported bundle holds
// more than one prepared dataset). The .data-prep label rule lays
// it out as a column flex (text line, gap, field), so the label
// has real visible area, but it had zero hover feedback: every
// label :hover rule in the cascade is scoped elsewhere (author
// toggles, parameter/action editors, O-mode notice, admin dialog
// and admin labels, connector/sign-in/collection labels, the
// change-type and embed labels, and the slice-103/104/105/106/
// 107/108 prep-columns, prep-key-column, prep-document-bar,
// prep-step-editor, prep-input-config and prep-staging labels —
// none of whose containers this label sits in), so the label
// rested transparent and hovering its text or gap changed
// nothing, while only the select inside it tinted via the
// slice-31 select hover. The label renders only for multi-dataset
// bundle imports, so route audits never hover it (the conditional
// blind spot of slices 84/88). This was a fresh zero-hover audit
// on the data-prep surface, follow-on to slices 103–108. The
// label now takes #edf6fc, the data-prep surface's established
// hover tint (the slice-31 select hover, the slice-39 button and
// input/textarea hovers, and the slice-103–108 prep label
// hovers), so no new colour is introduced. The child-combinator
// scope (.data-prep > label) targets exactly this direct-child
// label: the document-bar, step-editor, input-config and staging
// labels are nested deeper and already take the identical tint
// via slices 105/106/107/108. Background only, so resting
// geometry is identical and there is no animation. The data-prep
// surface is fixed light, so no dark variant.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.data-prep > label:hover\s*\{([^}]*)\}/m);

test('the prep imported-dataset label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .data-prep > label :hover rule');
  assert.match(rule[1], /background:\s*#edf6fc/);
});

test('the hover tint matches the data-prep select and prep-columns hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep select hover must remain #edf6fc');
  assert.ok(styleCss.match(/\.prep-columns label:hover\s*\{[^}]*background:\s*#edf6fc/), 'the prep-columns label hover must remain #edf6fc');
});

test('the prep imported-dataset label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting data-prep label rules are preserved and the fixed-light prep surface gains no dark variant', () => {
  assert.ok(styleCss.match(/\.data-prep label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/), 'the data-prep label resting rule must remain');
  assert.ok(styleCss.match(/\.prep-document-bar > label:hover\s*\{[^}]*background:\s*#edf6fc/), 'the slice-105 document-bar label hover must remain');
  assert.ok(!/data-chrome=dark[^\n]*data-prep > label/.test(styleCss), 'the fixed-light data-prep surface must not gain a dark variant for this rule');
});

defineHoverCases('prep-imported-label hover', {
  html: `<section class="data-prep">`
      + `<label id="importedLabel">Imported dataset<select><option>Choose dataset</option></select></label>`
      + `<div class="prep-document-bar"><label id="docLabel">Dataset name<input type="text"></label></div>`
      + `<section class="prep-configure"><div class="prep-staging">`
      + `<label id="stagingLabel">Stage a source<select><option>Sales</option></select></label>`
      + `</div><form class="prep-step-editor"><label id="stepLabel">Step name (optional)<input type="text"></label></form>`
      + `</section></section>`
      + `<label id="outsideLabel">Outside<input type="text"></label>`,
  cases: [
    {
      target: '#importedLabel',
      rule: '.data-prep > label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 246, 252)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#docLabel', '#stagingLabel', '#stepLabel', '#outsideLabel'],
    },
  ],
});
