import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 50: hover feedback for the Manage data dialog's
// per-dataset row-menu trigger (.data-row-menu summary, "More actions
// for …"). A fresh behavioral audit (real mouse hover + computed-style
// delta, Chromium) opening the Manage data dialog — a dialog no prior
// audit had opened — measured exactly one zero-hover control in it: this
// summary (28x24) went white -> white while every button in the same
// dialog tinted (.data-dialog button:hover, slices 16/30) and the menu's
// own item button tinted. Summary triggers elsewhere all take hover
// (card-footer slice 40, prep-execution slice 41, author-workspace
// slice 42); this one was missed because it is a <summary>, not a
// <button>. It now takes the data surface's tint (#eaf3f7, slices
// 16/21/27/48/49). Background only, so resting geometry is identical.
// Static (no animation), so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.data-row-menu summary:hover\s*\{([^}]*)\}/);

test('the row-menu summary hover rule exists and uses the data surface tint', () => {
  assert.ok(hoverRule, 'expected the .data-row-menu summary:hover rule');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the .data-row-menu summary hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting row-menu summary rules still reserve the geometry the hover keeps', () => {
  const resting = css.match(/\.data-row-menu summary\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .data-row-menu summary resting rule');
  assert.match(resting[1], /padding:\s*4px 6px/);
  assert.match(resting[1], /border:\s*1px solid #8ca6b4/);
  assert.match(resting[1], /background:\s*white/);
  assert.match(resting[1], /cursor:\s*pointer/);
});

test('the row-menu summary hover rule coexists with the dialog button hover rule', () => {
  assert.ok(css.match(/\.data-dialog button:hover:not\(:disabled\):not\(\.data-primary\)/), 'the .data-dialog button hover rule (slices 16/30) must still be present');
  assert.ok(css.match(/\.data-menu-items button:hover/), 'the data menu items hover rule must still be present');
  assert.ok(hoverRule, 'expected the .data-row-menu summary hover rule');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><details class="data-row-menu" id="menu">
      <summary id="trigger" aria-label="More actions for Sample sales data">⋯</summary>
      <div><button type="button">Remove dataset</button></div>
    </details>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '') === '.data-row-menu summary:hover') rules.push(rule);
        }
      }
      const trigger = document.querySelector('#trigger');
      const rest = { background: getComputedStyle(trigger).backgroundColor, box: JSON.stringify(trigger.getBoundingClientRect().toJSON()) };
      const hover = rules[0];
      if (hover) for (const prop of hover.style) trigger.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(trigger).backgroundColor, box: JSON.stringify(trigger.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        rest,
        hovered,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.hovered.background, 'rgb(234, 243, 247)');
    assert.notEqual(actual.rest.background, actual.hovered.background);
    assert.equal(actual.rest.box, actual.hovered.box);
  });
}
