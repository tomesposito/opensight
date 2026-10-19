import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 33: hover feedback for the fixture-picker select in
// the product header (Developer fixture preview page). A fresh behavioral
// hover audit (real mouse hover with computed-style delta measurement,
// Chromium, demo-mode bridge) re-audited the landing routes (0 candidates:
// the landing-surface hover thread stays complete since slice 29), the
// folders/data routes (0 real: the Data page's "Create data source" hit is
// the known closed-<details> false positive from slice 32), and — after
// expanding the rail's collapsed "More" disclosure — the admin/developer
// routes, finding `.product-header .fixture-picker select` as the largest
// real user-facing control with zero hover state. It takes the header's own
// hover tint (#365764, like the brand mark, navigation toggle and account
// menu) with light text so the dark resting text stays readable. Paint-only:
// the rule changes background and color, so resting geometry is identical
// and there is no animation to need a reduced-motion variant.
const chromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const selectRule = chromeCss.match(/\.product-header\s+\.fixture-picker\s+select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the fixture-picker select has a hover state with the header tint', () => {
  assert.ok(selectRule, 'expected .product-header .fixture-picker select:hover:not(:disabled)');
  assert.match(selectRule[1], /background:\s*#365764/);
  assert.match(selectRule[1], /color:\s*#fff/);
});

test('the fixture-picker hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(selectRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|text-decoration/.test(selectRule[1]), 'hover must change background/color only');
});

test('the fixture-picker resting rule is preserved', () => {
  const base = chromeCss.match(/\.product-header\s+\.fixture-picker\s+select\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the resting select rule');
  assert.ok(!/background:|color:/.test(base[1]), 'resting rule must not set background or color');
  assert.match(base[1], /max-width:\s*260px/);
});

describe('fixture-picker select hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${chromeCss}</style>`
      + `<header class="app-shell"><div class="product-header"><label class="fixture-picker">Definition example<select id="s"><option>TotalDeathByCountry</option><option>Renderable Sales (Synthetic)</option></select></label></div></header>`);
    const actual = await page.evaluate(() => {
      const find = text => {
        const hits = [];
        for (const s of document.styleSheets) for (const r of s.cssRules) if (r.selectorText === text) hits.push(r);
        return hits;
      };
      const el = document.querySelector('#s');
      const rules = find('.product-header .fixture-picker select:hover:not(:disabled)');
      const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      for (const prop of rules[0].style) el.style.setProperty(prop, rules[0].style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        rest,
        hovered,
        backgroundColor: rules[0].style.getPropertyValue('background-color'),
        color: rules[0].style.getPropertyValue('color'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.backgroundColor, 'rgb(54, 87, 100)');
    assert.equal(actual.color, 'rgb(255, 255, 255)');
    assert.notEqual(actual.rest.background, actual.hovered.background);
    assert.equal(actual.hovered.background, 'rgb(54, 87, 100)');
    assert.equal(actual.hovered.color, 'rgb(255, 255, 255)');
    assert.equal(actual.rest.box, actual.hovered.box);
  });
});
