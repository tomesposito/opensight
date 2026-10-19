import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 41: hover feedback for the data-prep
// "Dataset execution" disclosure summary. Slice 40's behavioral hover
// audit (real mouse hover + computed-style delta, Chromium, demo routes)
// left exactly one noted lead on the data-prep surface: the
// .prep-execution summary ("Dataset execution · mode, refresh and cached
// output") measured transparent -> transparent while every button,
// select, input and textarea around it tinted (slices 31/39). It already
// has the pointer cursor, the global focus outline and the slice-15
// :active press; hover was the missing state. It now takes the data-prep
// surface's own hover tint (#edf6fc, the buttons/selects/inputs
// language). Background only, so resting geometry is identical. Static
// (no animation), so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.prep-execution\s+summary:hover\s*\{([^}]*)\}/);

test('the prep-execution summary hover rule exists and uses the data-prep tint', () => {
  assert.ok(hoverRule, 'expected .prep-execution summary:hover');
  assert.match(hoverRule[1], /background:\s*#edf6fc/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the prep-execution summary hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting prep-execution rules still reserve the geometry the hover keeps', () => {
  const block = css.match(/\.prep-execution \{([^}]*)\}/);
  assert.ok(block, 'expected the .prep-execution resting rule');
  assert.match(block[1], /margin:\s*8px 0/);
  const summary = css.match(/\.prep-execution summary \{([^}]*)\}/);
  assert.ok(summary, 'expected the .prep-execution summary resting rule');
  assert.match(summary[1], /cursor:\s*pointer/);
});

test('the prep-execution summary hover rule coexists with the other summary states', () => {
  assert.ok(css.match(/\.card-footer\s+summary:hover/), 'the card-footer summary hover rule must still be present');
  assert.ok(css.match(/summary:active\s*\{[^}]*transform:\s*translateY\(1px\)/), 'the global summary :active press must still be present');
  assert.ok(css.match(/summary:focus-visible/), 'the global summary focus-visible outline must still be present');
  assert.ok(hoverRule, 'expected the prep-execution summary hover rule');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><section class="data-prep"><details class="prep-execution"><summary id="exec">Dataset execution · mode, refresh and cached output</summary></details></section><details><summary id="outside">Outside summary</summary></details>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '') === '.prep-execution summary:hover') rules.push(rule);
        }
      }
      const measure = el => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        const hover = rules[0];
        for (const prop of hover.style) el.style.setProperty(prop, hover.style.getPropertyValue(prop));
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      const exec = document.querySelector('#exec');
      const outside = document.querySelector('#outside');
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        exec: measure(exec),
        execMatches: exec.matches('.prep-execution summary'),
        outsideMatches: outside.matches('.prep-execution summary'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(237, 246, 252)');
    assert.equal(actual.exec.rest.background, 'rgba(0, 0, 0, 0)');
    assert.equal(actual.exec.hovered.background, 'rgb(237, 246, 252)');
    assert.equal(actual.exec.rest.color, actual.exec.hovered.color, 'text color must not change');
    assert.equal(actual.exec.rest.box, actual.exec.hovered.box);
    assert.ok(actual.execMatches);
    assert.equal(actual.outsideMatches, false, 'summaries outside the prep-execution disclosure keep their own states');
  });
}
