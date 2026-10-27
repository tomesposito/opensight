import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 77: hover feedback for the Create Analysis
// dialog's selected dataset row (.dataset-picker-table tbody
// tr[data-selected] in CreateAnalysisDialog.tsx). The only row hover
// rule explicitly excludes the selected row
// (tr[data-selectable]:not([data-selected]):hover -> #f2f9fd) and no
// other tr:hover rule exists, so hovering the selected (clickable) row
// changed nothing, while every unselected selectable row steps
// transparent -> #f2f9fd. Following the slices 28/29/73-76
// selected-control language, the selected row now takes a dedicated
// hover step one visible step deeper than its #eef8fd resting tint:
// #d6effd, already this table's own header tint, so no new color is
// introduced. Scoped to [data-selectable] so a retained selection on
// an unavailable, non-clickable row keeps its flat state. Background
// only, so resting geometry is identical; static (no animation), so
// no reduced-motion variant.
const css = styles['style.css'];

const rule = css.match(/\.dataset-picker-table tbody tr\[data-selectable\]\[data-selected\]:hover\s*\{([^}]*)\}/);

test('the selected dataset-row hover rule exists and uses the table header tint', () => {
  assert.ok(rule, 'expected the .dataset-picker-table tbody tr[data-selectable][data-selected]:hover rule');
  assert.match(rule[1], /background:\s*#d6effd/);
});

test('the hover tint is the table own header tint, deeper than the selected rest tint', () => {
  assert.ok(css.match(/\.dataset-picker-table th\s*\{[^}]*background:\s*#d6effd/), 'the table header tint must remain #d6effd');
  const selected = css.match(/\.dataset-picker-table tr\[data-selected\]\s*\{([^}]*)\}/);
  assert.ok(selected, 'expected the selected row resting rule');
  assert.match(selected[1], /background:\s*#eef8fd/);
  assert.notEqual('#d6effd', '#eef8fd', 'the hover tint must differ from the resting tint');
});

test('the selected-row hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting row rules are preserved', () => {
  const selected = css.match(/\.dataset-picker-table tr\[data-selected\]\s*\{([^}]*)\}/);
  assert.ok(selected, 'expected the selected row resting rule');
  assert.match(selected[1], /background:\s*#eef8fd/);
  assert.ok(css.match(/\.dataset-picker-table tbody tr\[data-selectable\]\s*\{\s*cursor:\s*pointer/), 'selectable rows must keep the pointer cursor');
});

test('the neighbouring dataset-picker rules are untouched', () => {
  assert.ok(css.match(/\.dataset-picker-table tbody tr\[data-selectable\]:not\(\[data-selected\]\):hover\s*\{\s*background:\s*#f2f9fd/), 'the unselected selectable row hover must remain #f2f9fd');
  assert.ok(css.match(/\.dataset-picker-table th\s*\{[^}]*background:\s*#d6effd/), 'the table header rule must remain');
});

defineHoverCases('dataset-picker-selected-row hover', {
  html: `<div class="dataset-picker-table"><table><tbody>
      <tr id="selected" data-selectable data-selected><td>Sales</td></tr>
      <tr id="unselected" data-selectable><td>Traffic</td></tr>
      <tr id="selected-stuck" data-selected><td>Legacy</td></tr>
    </tbody></table></div>`,
  cases: [
    {
      target: '#selected',
      rule: '.dataset-picker-table tbody tr[data-selectable][data-selected]:hover',
      resting: { backgroundColor: 'rgb(238, 248, 253)' },
      hovered: { backgroundColor: 'rgb(214, 239, 253)' },
      paintOnly: true,
      excluded: [{ target: '#unselected', resting: { backgroundColor: 'rgba(0, 0, 0, 0)' } }, { target: '#selected-stuck', resting: { backgroundColor: 'rgb(238, 248, 253)' }, hovered: { backgroundColor: 'rgb(238, 248, 253)' } }],
    },
  ],
});
