import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 49: hover feedback for the Create Dataset
// dialog's connector tiles. Slice 48's behavioral audit (real mouse hover
// + computed-style delta, Chromium, creation dialogs opened) measured the
// connector tiles (.data-connector-tile, 301x82) zero-hover and left them
// as the next lead, pending the selection-card question that slice 45
// settled for the sheet-type cards: an enabled selection card takes the
// surface hover tint. The tiles are labels with a pointer cursor and a
// resting border, while every field and button around them in the same
// dialog tinted (slices 16/30/48). An unselected, enabled tile now takes
// the data surface's tint (#eaf3f7, slices 16/21/27/48). The selected
// tile is excluded: it already rests distinct at #f0f8fb with the teal
// border. Tiles whose connector is unimplemented carry a disabled radio
// and are excluded via :has(> input:disabled), so they keep their flat
// resting state. Background only, so resting geometry is identical;
// static (no animation), so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.data-connector-tile:hover:not\(\[data-selected=true\]\):not\(:has\(> input:disabled\)\)\s*\{([^}]*)\}/);

test('the connector-tile hover rule exists and uses the data surface tint', () => {
  assert.ok(hoverRule, 'expected the .data-connector-tile hover rule');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the .data-connector-tile hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting tile rules still reserve the geometry the hover keeps', () => {
  const resting = css.match(/\.data-connector-tile\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .data-connector-tile resting rule');
  assert.match(resting[1], /padding:\s*16px 12px/);
  assert.match(resting[1], /border:\s*1px solid #d3dfe5/);
  assert.match(resting[1], /cursor:\s*pointer/);
  const selected = css.match(/\.data-connector-tile\[data-selected=true\]\s*\{([^}]*)\}/);
  assert.ok(selected, 'expected the selected tile resting rule');
  assert.match(selected[1], /background:\s*#f0f8fb/);
  assert.match(selected[1], /border-color:\s*#176b88/);
});

test('the tile hover rule coexists with the data-dialog field hover rule', () => {
  assert.ok(css.match(/\.data-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\)/), 'the data-dialog field hover rule (slice 48) must still be present');
  assert.ok(hoverRule, 'expected the .data-connector-tile hover rule');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="data-connector-grid">
      <label class="data-connector-tile" id="enabled" data-selected="false"><span aria-hidden="true">▤</span><span><strong>File upload</strong><small>.csv</small></span><input type="radio" name="connector"></label>
      <label class="data-connector-tile" id="selected" data-selected="true"><span aria-hidden="true">▤</span><span><strong>PostgreSQL</strong><small>Connected</small></span><input type="radio" name="connector" checked></label>
      <label class="data-connector-tile" id="disabled" data-selected="false"><span aria-hidden="true">▤</span><span><strong>MySQL</strong><small>Not available</small></span><input type="radio" name="connector" disabled></label>
    </div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '').replace(/"/g, '');
          if (sel === '.data-connector-tile:hover:not([data-selected=true]):not(:has(> input:disabled))') rules.push(rule);
        }
      }
      const enabled = document.querySelector('#enabled');
      const selected = document.querySelector('#selected');
      const disabled = document.querySelector('#disabled');
      const rest = { background: getComputedStyle(enabled).backgroundColor, box: JSON.stringify(enabled.getBoundingClientRect().toJSON()) };
      const hover = rules[0];
      if (hover) for (const prop of hover.style) enabled.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(enabled).backgroundColor, box: JSON.stringify(enabled.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        enabled: { rest, hovered },
        enabledMatches: enabled.matches(':not([data-selected=true]):not(:has(> input:disabled))'),
        selectedMatches: selected.matches(':not([data-selected=true]):not(:has(> input:disabled))'),
        disabledMatches: disabled.matches(':not([data-selected=true]):not(:has(> input:disabled))'),
        selectedBg: getComputedStyle(selected).backgroundColor,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.enabled.hovered.background, 'rgb(234, 243, 247)');
    assert.notEqual(actual.enabled.rest.background, actual.enabled.hovered.background);
    assert.equal(actual.enabled.rest.box, actual.enabled.hovered.box);
    assert.ok(actual.enabledMatches);
    assert.equal(actual.selectedMatches, false, 'selected tile keeps its distinct resting state');
    assert.equal(actual.disabledMatches, false, 'unimplemented tile keeps its flat resting state');
    assert.equal(actual.selectedBg, 'rgb(240, 248, 251)', 'selected tile keeps its resting tint');
  });
}
