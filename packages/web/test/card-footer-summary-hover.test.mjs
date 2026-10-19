import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 40: hover feedback for the visual-card footer
// "View data" summary. A fresh behavioral hover audit across the demo
// routes (real mouse hover + computed-style delta, Chromium) — the first
// audit whose selector set included <summary> — found the card footer's
// disclosure summary measured transparent -> transparent on the home and
// fixture-preview surfaces (545x17, hit-testable, :hover applied): other
// summaries already tint on hover (.account-menu, .author-menu,
// .data-menu), and this one already has the global cursor, focus outline
// and :active press, but no hover state at all. It now takes the landing
// surfaces' menu tint (#eaf3f7). Background only, so resting geometry is
// identical. Static (no animation), so no reduced-motion variant is
// needed.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.card-footer\s+summary:hover\s*\{([^}]*)\}/);

test('the card-footer summary hover rule exists and uses the landing menu tint', () => {
  assert.ok(hoverRule, 'expected .card-footer summary:hover');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the card-footer summary hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting card-footer rules still reserve the geometry the hover keeps', () => {
  const footer = css.match(/\.card-footer \{([^}]*)\}/);
  assert.ok(footer, 'expected the .card-footer resting rule');
  assert.match(footer[1], /padding:\s*0 20px/);
  assert.match(footer[1], /color:\s*#607784/);
  const details = css.match(/\.card-footer details \{([^}]*)\}/);
  assert.ok(details, 'expected the .card-footer details resting rule');
  assert.match(details[1], /padding:\s*9px 0/);
});

test('the card-footer summary hover rule coexists with the other summary states', () => {
  assert.ok(css.match(/\.author-menu summary:hover/), 'the author-menu summary hover rule must still be present');
  assert.ok(css.match(/summary:active\s*\{[^}]*transform:\s*translateY\(1px\)/), 'the global summary :active press must still be present');
  assert.ok(css.match(/summary:focus-visible/), 'the global summary focus-visible outline must still be present');
  assert.ok(hoverRule, 'expected the card-footer summary hover rule');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="visual-card"><div class="card-footer"><details><summary id="view">View data · 1 row</summary></details></div></div><details><summary id="outside">Outside summary</summary></details>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '') === '.card-footer summary:hover') rules.push(rule);
        }
      }
      const measure = el => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        const hover = rules[0];
        for (const prop of hover.style) el.style.setProperty(prop, hover.style.getPropertyValue(prop));
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      const view = document.querySelector('#view');
      const outside = document.querySelector('#outside');
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        view: measure(view),
        viewMatches: view.matches('.card-footer summary'),
        outsideMatches: outside.matches('.card-footer summary'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.view.rest.background, 'rgba(0, 0, 0, 0)');
    assert.equal(actual.view.hovered.background, 'rgb(234, 243, 247)');
    assert.equal(actual.view.rest.color, actual.view.hovered.color, 'text color must not change');
    assert.equal(actual.view.rest.box, actual.view.hovered.box);
    assert.ok(actual.viewMatches);
    assert.equal(actual.outsideMatches, false, 'summaries outside a card footer keep their own states');
  });
}
