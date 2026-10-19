import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 34: hover feedback for the fixture-notice "Open
// Home" link. A fresh behavioral hover audit (real mouse hover with
// computed-style delta measurement, Chromium, demo-mode bridge) found this
// link (Developer fixture preview page: "Questions are unavailable for
// definition previews. Open Home to explore sample sales data.") as the last
// user-facing control with zero hover state — hovering the link changed
// nothing. The landing-surface hover thread stays complete since slice 29.
// The app-wide menu-item tint (#eaf3f7, slices 16/21/25/26/30/32) is
// invisible against the notice's own #eaf2f3 background, so the link takes
// the palette's darker blue-gray step (#d4dfe7). Paint-only: the rule
// changes the background, so resting geometry is identical and there is no
// animation to need a reduced-motion variant.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const linkRule = styleCss.match(/\.fixture-notice\s+a:hover\s*\{([^}]*)\}/);

test('the fixture-notice link has a hover state with the darker palette tint', () => {
  assert.ok(linkRule, 'expected .fixture-notice a:hover');
  assert.match(linkRule[1], /background:\s*#d4dfe7/);
});

test('the notice-link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(linkRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|text-decoration/.test(linkRule[1]), 'hover must change background only');
});

test('the notice link has no resting background of its own to disturb', () => {
  // The parent .fixture-notice carries the tinted background; the link
  // itself rests transparent, so adding a hover background is additive.
  const linkRest = styleCss.match(/\.fixture-notice\s+a\s*\{([^}]*)\}/);
  assert.ok(!linkRest || !/background:/.test(linkRest[1]), 'no resting background on the link itself');
});

describe('fixture-notice link hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${styleCss}</style>`
      + `<section><p class="fixture-notice">Questions are unavailable for definition previews. <a href="#/home" id="a">Open Home to explore sample sales data.</a></p></section>`);
    const actual = await page.evaluate(() => {
      const find = text => {
        const hits = [];
        for (const s of document.styleSheets) for (const r of s.cssRules) if (r.selectorText === text) hits.push(r);
        return hits;
      };
      const el = document.querySelector('#a');
      const rules = find('.fixture-notice a:hover');
      const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, deco: getComputedStyle(el).textDecorationLine, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      for (const prop of rules[0].style) el.style.setProperty(prop, rules[0].style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, deco: getComputedStyle(el).textDecorationLine, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        rest,
        hovered,
        backgroundColor: rules[0].style.getPropertyValue('background-color'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.backgroundColor, 'rgb(212, 223, 231)');
    assert.equal(actual.rest.background, 'rgba(0, 0, 0, 0)');
    assert.equal(actual.hovered.background, 'rgb(212, 223, 231)');
    assert.equal(actual.rest.color, actual.hovered.color);
    assert.equal(actual.rest.deco, actual.hovered.deco);
    assert.equal(actual.rest.box, actual.hovered.box);
  });
});
