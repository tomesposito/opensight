import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

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
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

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

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="dataset-picker-table"><table><tbody>
      <tr id="selected" data-selectable data-selected><td>Sales</td></tr>
      <tr id="unselected" data-selectable><td>Traffic</td></tr>
      <tr id="selected-stuck" data-selected><td>Legacy</td></tr>
    </tbody></table></div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '').replace(/"/g, '');
          if (sel === '.dataset-picker-table tbody tr[data-selectable][data-selected]:hover') rules.push(rule);
        }
      }
      const selected = document.querySelector('#selected');
      const unselected = document.querySelector('#unselected');
      const stuck = document.querySelector('#selected-stuck');
      const rest = { background: getComputedStyle(selected).backgroundColor, box: JSON.stringify(selected.getBoundingClientRect().toJSON()) };
      const hover = rules[0];
      if (hover) for (const prop of hover.style) selected.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(selected).backgroundColor, box: JSON.stringify(selected.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        selected: { rest, hovered },
        selectedMatches: selected.matches('[data-selectable][data-selected]'),
        unselectedMatches: unselected.matches('[data-selectable][data-selected]'),
        stuckMatches: stuck.matches('[data-selectable][data-selected]'),
        unselectedBg: getComputedStyle(unselected).backgroundColor,
        stuckBg: getComputedStyle(stuck).backgroundColor,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(214, 239, 253)');
    assert.equal(actual.selected.rest.background, 'rgb(238, 248, 253)');
    assert.equal(actual.selected.hovered.background, 'rgb(214, 239, 253)');
    assert.notEqual(actual.selected.rest.background, actual.selected.hovered.background);
    assert.equal(actual.selected.rest.box, actual.selected.hovered.box);
    assert.ok(actual.selectedMatches);
    assert.equal(actual.unselectedMatches, false, 'unselected row keeps the existing row hover rule');
    assert.equal(actual.stuckMatches, false, 'selected but non-selectable row keeps its flat resting state');
    assert.equal(actual.unselectedBg, 'rgba(0, 0, 0, 0)', 'unselected row resting state unchanged');
    assert.equal(actual.stuckBg, 'rgb(238, 248, 253)', 'selected non-selectable row resting state unchanged');
  });
}
