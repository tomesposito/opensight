import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 76: hover feedback for the Create Dataset
// dialog's selected connector tile (.data-connector-tile[data-selected=true]
// in CreateDatasetDialog.tsx, stage 'source'). Slice 49 gave the
// unselected enabled tiles the data surface's hover tint (#eaf3f7) and
// deliberately excluded the selected tile because it already rests
// distinct at #f0f8fb with the #176b88 border — so hovering the chosen
// tile changed nothing, while every unselected enabled tile steps
// white -> #eaf3f7. A real-mouse probe on the demo dialog measured the
// selected tile (301x82) at rgb(240,248,251) on rest and hover alike.
// Following slice 28's selected-tab language (the selected data tab
// takes the surface hover tint on hover), the selected tile now takes
// the same established tint on hover: one visible step deeper than its
// resting #f0f8fb, distinct at rest via tint + border, both kept.
// A selected tile whose connector is unimplemented carries a disabled
// radio and is excluded via :has(> input:disabled), so it keeps its
// flat resting state. Background only, so resting geometry is
// identical; static (no animation), so no reduced-motion variant.
const css = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const rule = css.match(/\.data-connector-tile\[data-selected=true\]:hover:not\(:has\(> input:disabled\)\)\s*\{([^}]*)\}/);

test('the selected connector-tile hover rule exists and uses the data surface tint', () => {
  assert.ok(rule, 'expected the .data-connector-tile[data-selected=true]:hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint is the established data hover tint, deeper than the selected rest tint', () => {
  assert.ok(css.match(/\.data-page button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{\s*background:\s*#eaf3f7/), 'the slice 16 data-page hover tint must remain #eaf3f7');
  assert.ok(css.match(/\.data-tabs button\[aria-selected=true\]:hover:not\(:disabled\)\s*\{\s*background:\s*#eaf3f7/), 'the slice 28 selected-tab hover precedent must remain #eaf3f7');
  const selected = css.match(/\.data-connector-tile\[data-selected=true\]\s*\{([^}]*)\}/);
  assert.ok(selected, 'expected the selected tile resting rule');
  assert.match(selected[1], /background:\s*#f0f8fb/);
  assert.notEqual('#eaf3f7', '#f0f8fb', 'the hover tint must differ from the resting tint');
});

test('the selected-tile hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting tile rules are preserved', () => {
  const resting = css.match(/\.data-connector-tile\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .data-connector-tile resting rule');
  assert.match(resting[1], /padding:\s*16px 12px/);
  assert.match(resting[1], /border:\s*1px solid #d3dfe5/);
  assert.match(resting[1], /cursor:\s*pointer/);
  const selected = css.match(/\.data-connector-tile\[data-selected=true\]\s*\{([^}]*)\}/);
  assert.ok(selected, 'expected the selected tile resting rule');
  assert.match(selected[1], /border-color:\s*#176b88/);
  assert.match(selected[1], /background:\s*#f0f8fb/);
});

test('the neighbouring data-dialog hovers are untouched', () => {
  assert.ok(css.match(/\.data-connector-tile:hover:not\(\[data-selected=true\]\):not\(:has\(> input:disabled\)\)\s*\{\s*background:\s*#eaf3f7/), 'the slice 49 unselected tile hover must remain');
  assert.ok(css.match(/\.data-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\)/), 'the slice 48 data-dialog field hover must remain');
  assert.ok(css.match(/\.data-dialog button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{\s*background:\s*#eaf3f7/), 'the slice 30 data-dialog button hover must remain');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="data-connector-grid">
      <label class="data-connector-tile" id="selected" data-selected="true"><span aria-hidden="true">▤</span><span><strong>File upload</strong><small>.csv</small></span><input type="radio" name="connector" checked></label>
      <label class="data-connector-tile" id="unselected" data-selected="false"><span aria-hidden="true">▤</span><span><strong>PostgreSQL</strong><small>Connected</small></span><input type="radio" name="connector"></label>
      <label class="data-connector-tile" id="selected-disabled" data-selected="true"><span aria-hidden="true">▤</span><span><strong>MySQL</strong><small>Not available</small></span><input type="radio" name="connector" disabled></label>
    </div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '').replace(/"/g, '');
          if (sel === '.data-connector-tile[data-selected=true]:hover:not(:has(> input:disabled))') rules.push(rule);
        }
      }
      const selected = document.querySelector('#selected');
      const unselected = document.querySelector('#unselected');
      const selectedDisabled = document.querySelector('#selected-disabled');
      const rest = { background: getComputedStyle(selected).backgroundColor, border: getComputedStyle(selected).borderTopColor, box: JSON.stringify(selected.getBoundingClientRect().toJSON()) };
      const hover = rules[0];
      if (hover) for (const prop of hover.style) selected.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(selected).backgroundColor, border: getComputedStyle(selected).borderTopColor, box: JSON.stringify(selected.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        selected: { rest, hovered },
        selectedMatches: selected.matches('[data-selected=true]:not(:has(> input:disabled))'),
        unselectedMatches: unselected.matches('[data-selected=true]:not(:has(> input:disabled))'),
        selectedDisabledMatches: selectedDisabled.matches('[data-selected=true]:not(:has(> input:disabled))'),
        unselectedBg: getComputedStyle(unselected).backgroundColor,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.selected.rest.background, 'rgb(240, 248, 251)');
    assert.equal(actual.selected.hovered.background, 'rgb(234, 243, 247)');
    assert.notEqual(actual.selected.rest.background, actual.selected.hovered.background);
    assert.equal(actual.selected.rest.border, actual.selected.hovered.border, 'the selected border must be unchanged');
    assert.equal(actual.selected.rest.box, actual.selected.hovered.box);
    assert.ok(actual.selectedMatches);
    assert.equal(actual.unselectedMatches, false, 'unselected tile keeps the slice 49 hover rule');
    assert.equal(actual.selectedDisabledMatches, false, 'selected but unimplemented tile keeps its flat resting state');
    assert.equal(actual.unselectedBg, 'rgba(0, 0, 0, 0)', 'unselected tile resting state unchanged');
  });
}
