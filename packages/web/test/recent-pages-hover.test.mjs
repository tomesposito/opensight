import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 26: hover feedback for the "Recent pages" rows on
// the My stuff page. A fresh interactive-state audit of the landing surfaces
// (home/analyses/dashboards/data/my-stuff, with the earlier click-navigation
// mid-transition race fixed) found `ul.recent-pages > li > a` was the last
// control class with zero hover state: hovering a recent-page row changed
// nothing. They take the app-wide menu-item hover tint (#eaf3f7,
// slices 16/21/25). Paint-only: the rule changes the background, so resting
// geometry is identical and there is no animation to need a reduced-motion
// variant.
const chromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const rowsRule = chromeCss.match(/\.recent-pages\s+a:hover\s*\{([^}]*)\}/);

test('the recent-pages rows have a hover state with the menu-item tint', () => {
  assert.ok(rowsRule, 'expected .recent-pages a:hover');
  assert.match(rowsRule[1], /background:\s*#eaf3f7/);
});

test('the recent-pages hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rowsRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(rowsRule[1]), 'hover must change background only');
});

test('the recent-pages resting rule keeps the transparent base the hover replaces', () => {
  const base = chromeCss.match(/\.recent-pages\s+a\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the .recent-pages a base rule');
  assert.ok(!/background:/.test(base[1]), 'base rule must not set a background');
});

describe('recent-pages row hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${chromeCss}</style>`
      + `<ul class="recent-pages"><li><a href="#/home" id="a">Home</a></li><li><a href="#/data" id="b">Data</a></li></ul>`);
    const actual = await page.evaluate(() => {
      const find = text => {
        const hits = [];
        for (const s of document.styleSheets) for (const r of s.cssRules) if (r.selectorText === text) hits.push(r);
        return hits;
      };
      const el = document.querySelector('#a');
      const rules = find('.recent-pages a:hover');
      const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      for (const prop of rules[0].style) el.style.setProperty(prop, rules[0].style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        rest,
        hovered,
        backgroundColor: rules[0].style.getPropertyValue('background-color'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.background, 'rgba(0, 0, 0, 0)');
    assert.equal(actual.hovered.background, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.box, actual.hovered.box);
  });
});
