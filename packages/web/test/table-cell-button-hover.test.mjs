import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 72: hover feedback for the table row-selection
// button (.table-scroll td button in VisualCard's DataTable — the first
// column's value rendered as a button when the visual has an
// interaction, so clicking it applies the row's filter action). In the
// author workspace the generic author button hover (#edf7f7) reaches it,
// but a visual card on the consumer Dashboard renders in <main> inside
// .app-shell, outside .author-workspace and .data-prep, and a CSSOM
// audit (probe-slice72) showed the button matches zero :hover rules
// there: resting at color inherit / background transparent (the
// .visual-card resting rule), hovering changed nothing while the card's
// own footer summaries tint on hover. It now takes #eaf3f7 — that
// card-footer summary tint. The new selector ties the visual-card
// resting rule at (0,2,2) and wins by standing after it; it stays below
// the author (0,3,1) and data-prep (0,3,1) button hovers, so those
// contexts keep their own tints unchanged (verified by real-mouse
// probe: the author-context button still hovers to rgb(237,247,247)
// after the fix). Background only, so resting geometry is identical
// and there is no animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/\.table-scroll\s+td\s+button:hover\s*\{([^}]*)\}/);

test('the table cell button has a hover state with the card tint', () => {
  assert.ok(rule, 'expected the .table-scroll td button hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the cell hover tint matches the card-footer summary hover tint', () => {
  assert.ok(styleCss.match(/\.card-footer\s+summary:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the card-footer summary hover must remain #eaf3f7');
});

test('the cell hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:|text-decoration/.test(rule[1]), 'hover must change background only');
});

test('the resting table cell button rules are preserved', () => {
  assert.ok(styleCss.match(/\.table-scroll td button\s*\{[^}]*color:\s*#126a74[^}]*text-decoration:\s*underline/), 'the generic cell-button resting rule must remain');
  assert.ok(styleCss.match(/\.visual-card \.table-scroll td button\s*\{[^}]*color:\s*inherit[^}]*background:\s*transparent/), 'the visual-card cell-button resting rule must remain');
});

test('the neighbouring scoped button hovers are untouched', () => {
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#edf7f7/), 'the author button hover must remain');
  assert.ok(styleCss.match(/\.data-prep button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep button hover must remain');
  assert.ok(styleCss.match(/\.action-status button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'slice 61 action-status hover must remain');
});

defineHoverCases('table-cell-button hover', {
  html: `<section class="visual-card"><div class="visual-content"><div class="table-scroll"><table><tbody><tr><td><button id="cell" type="button">East</button></td><td>42</td></tr></tbody></table></div></div></section>`
      + `<div class="table-scroll"><p><button id="outside" type="button">Outside a cell</button></p></div>`,
  cases: [
    {
      target: '#cell',
      rule: '.table-scroll td button:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)', textDecorationLine: 'underline' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color', 'textDecorationLine'],
      excluded: ['#outside'],
    },
  ],
});
