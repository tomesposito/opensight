import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 120: hover feedback for the Create Analysis
// dialog's pagination label (.dataset-picker-pagination label —
// "Items per page" in CreateAnalysisDialog.tsx, wrapping the page-size
// select in the dialog's pagination row). The resting rule
// (.dataset-picker-pagination label { display: flex; align-items:
// center; gap: 8px; }) makes the label a visible surface (text, gap,
// select), but the label had zero hover feedback: slices 16/23 hovered
// the dialog's buttons and the select inside this label, slice 48 its
// search input, and every label :hover rule in the cascade is scoped
// elsewhere (author labels, calculation/analysis-file/data dialogs,
// prep labels, connector/sign-in/collection labels, admin labels,
// embed labels). A CSSOM probe with all five real stylesheets (1,386
// rules) in the real ancestor context (dialog.create-analysis-dialog >
// form > .dataset-picker-pagination > label) confirmed zero matching
// :hover rules for the label and a transparent rest, while the select
// inside it matched the slice-23 select hover. The label now takes
// #edf7fc, the dialog's established hover tint (its button, select and
// search-input hovers), so no new colour is introduced — and because
// the label and the select inside it take the same tint, hovering
// either reads as one surface, not two steps. Background only, so
// resting geometry is identical and there is no animation; the dialog
// is a fixed-light surface, so no dark variant.
const styleCss = styles['style.css'];

const labelRule = styleCss.match(/^\.dataset-picker-pagination label:hover\s*\{([^}]*)\}/m);

test('the pagination label hover rule exists and uses the established hover tint', () => {
  assert.ok(labelRule, 'expected the dataset-picker-pagination label :hover rule');
  assert.match(labelRule[1], /background:\s*#edf7fc/);
});

test('the hover tint matches the dialog button, select and search-input hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.create-analysis-dialog button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7fc/), 'the dialog button hover must remain #edf7fc');
  assert.ok(styleCss.match(/\.create-analysis-dialog\s+select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7fc/), 'the dialog select hover must remain #edf7fc');
  assert.ok(styleCss.match(/\.create-analysis-dialog input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7fc/), 'the dialog search-input hover must remain #edf7fc');
});

test('the pagination label hover rule is paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(labelRule, 'expected the dataset-picker-pagination label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting pagination rules are preserved', () => {
  assert.ok(styleCss.match(/\.dataset-picker-pagination\s*\{[^}]*display:\s*flex/), 'the resting pagination row rule must remain');
  assert.ok(styleCss.match(/\.dataset-picker-pagination label\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*gap:\s*8px/), 'the resting pagination label rule must remain');
  assert.ok(styleCss.match(/\.dataset-picker-pagination select\s*\{[^}]*padding:\s*3px 6px/), 'the resting pagination select rule must remain');
});

defineHoverCases('pagination-label hover', {
  html: `<dialog class="create-analysis-dialog" open><form>`
      + `<div class="dataset-picker-pagination"><label id="pageLabel">Items per page <select id="pageSelect"><option>25</option></select></label></div>`
      + `<label id="dialogLabel">Other label<input id="dialogInput"/></label>`
      + `</form></dialog>`
      + `<div class="dataset-picker-pagination"><label id="outsideDialogLabel">Items per page <select><option>25</option></select></label></div>`,
  cases: [
    {
      target: '#pageLabel',
      rule: '.dataset-picker-pagination label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 252)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#dialogLabel'],
    },
  ],
});
