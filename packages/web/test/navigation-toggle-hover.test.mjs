import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 24: hover feedback for the shell header's
// navigation toggle. A fresh interactive-state audit of the app shell found
// `.navigation-toggle` (the hamburger button in `.product-header`, visible on
// narrow viewports and always in author mode) was the last header-chrome
// control with zero hover state: hovering it changed nothing. Its siblings
// already carry the established dark-chrome hover language from slice 17
// (`.product-header .brand:hover`, `.account-menu summary:hover`), so the
// toggle takes the same tint (#365764). Paint-only: the rule changes the
// background, so resting geometry is identical and there is no animation to
// need a reduced-motion variant.
const chromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const toggleRule = chromeCss.match(/\.product-header\s+\.navigation-toggle:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the header navigation toggle has a hover state with the dark-chrome tint', () => {
  assert.ok(toggleRule, 'expected .product-header .navigation-toggle:hover:not(:disabled)');
  assert.match(toggleRule[1], /background:\s*#365764/);
});

test('the toggle hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(toggleRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(toggleRule[1]), 'hover must change background only');
});

test('the toggle resting rule keeps the transparent base the hover replaces', () => {
  const base = chromeCss.match(/\.navigation-toggle\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the .navigation-toggle base rule');
  assert.match(base[1], /background:\s*transparent/);
});

describe('navigation toggle hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${chromeCss}</style>`
      + `<header class="product-header"><button class="navigation-toggle" id="nav">☰</button><button class="navigation-toggle" id="dis" disabled>☰</button></header>`);
    const actual = await page.evaluate(() => {
      const find = text => {
        const hits = [];
        for (const s of document.styleSheets) for (const r of s.cssRules) if (r.selectorText === text) hits.push(r);
        return hits;
      };
      const el = document.querySelector('#nav');
      const dis = document.querySelector('#dis');
      const rules = find('.product-header .navigation-toggle:hover:not(:disabled)');
      const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      for (const prop of rules[0].style) el.style.setProperty(prop, rules[0].style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        rest,
        hovered,
        backgroundColor: rules[0].style.getPropertyValue('background-color'),
        disabledMatches: dis.matches('.product-header .navigation-toggle:hover:not(:disabled)'),
        disabledRest: getComputedStyle(dis).backgroundColor,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.backgroundColor, 'rgb(54, 87, 100)');
    assert.equal(actual.rest.background, 'rgba(0, 0, 0, 0)');
    assert.equal(actual.hovered.background, 'rgb(54, 87, 100)');
    assert.equal(actual.rest.box, actual.hovered.box);
    assert.equal(actual.disabledMatches, false);
    assert.equal(actual.disabledRest, 'rgba(0, 0, 0, 0)');
  });
});
