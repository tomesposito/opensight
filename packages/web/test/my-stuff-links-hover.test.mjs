import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 25: hover feedback for the my-stuff collection
// quick links. A fresh interactive-state audit of the landing surfaces found
// `nav.my-stuff-links a` ("My analyses", "Dashboards", "My folders", "Shared
// folders") was the last control class with zero hover state: hovering them
// changed nothing. They take the app-wide menu-item hover tint (#eaf3f7,
// slices 16/21). Paint-only: the rule changes the background, so resting
// geometry is identical and there is no animation to need a reduced-motion
// variant.
const chromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const linksRule = chromeCss.match(/\.my-stuff-links\s+a:hover\s*\{([^}]*)\}/);

test('the my-stuff quick links have a hover state with the menu-item tint', () => {
  assert.ok(linksRule, 'expected .my-stuff-links a:hover');
  assert.match(linksRule[1], /background:\s*#eaf3f7/);
});

test('the quick-link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(linksRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(linksRule[1]), 'hover must change background only');
});

test('the quick-link resting rule keeps the transparent base the hover replaces', () => {
  const base = chromeCss.match(/\.my-stuff-links\s+a\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the .my-stuff-links a base rule');
  assert.ok(!/background:/.test(base[1]), 'base rule must not set a background');
});

describe('my-stuff quick-link hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${chromeCss}</style>`
      + `<nav class="my-stuff-links"><a href="#/analyses" id="a">My analyses</a><a href="#/dashboards" id="b">Dashboards</a></nav>`);
    const actual = await page.evaluate(() => {
      const find = text => {
        const hits = [];
        for (const s of document.styleSheets) for (const r of s.cssRules) if (r.selectorText === text) hits.push(r);
        return hits;
      };
      const el = document.querySelector('#a');
      const rules = find('.my-stuff-links a:hover');
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
