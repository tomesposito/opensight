import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 71: hover feedback for the first-run header's
// brand link (.first-run-header .brand in FirstRun.tsx). Verified lead
// from slice 70: this link matched zero :hover rules. The product
// header's brand hover (.product-header .brand:hover in app-chrome.css)
// is scoped to .product-header, and the first-run page is standalone
// (SessionGate renders it before any session, outside .app-shell), so
// no app-shell rule reaches it either. Its only rules set the white
// resting color (.first-run-header .brand) and the teal mark, so
// hovering it changed nothing while the same brand link in the product
// header tints on hover. It now takes that header's own dark-chrome
// hover tint (#365764, the .product-header .brand:hover tint), which
// matches the first-run header's dark #162e40 resting background.
// Background only, so resting geometry is identical and there is no
// animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const appChromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const rule = styleCss.match(/\.first-run-header\s+\.brand:hover\s*\{([^}]*)\}/);

test('the first-run header brand has a hover state with the dark-chrome tint', () => {
  assert.ok(rule, 'expected the .first-run-header .brand hover rule');
  assert.match(rule[1], /background:\s*#365764/);
});

test('the brand hover tint matches the product-header brand hover tint', () => {
  assert.ok(appChromeCss.match(/\.product-header\s+\.brand:hover\s*\{[^}]*background:\s*#365764/), 'the product-header brand hover must remain #365764');
});

test('the brand hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting first-run header rules are preserved', () => {
  assert.ok(styleCss.match(/\.first-run-header\s*\{[^}]*background:\s*#162e40/), 'the header resting rule must remain');
  assert.ok(styleCss.match(/\.first-run-header \.brand\s*\{[^}]*color:\s*#fff/), 'the brand resting color must remain');
  assert.ok(styleCss.match(/\.first-run-header \.brand-mark\s*\{[^}]*color:\s*#72d3d4/), 'the brand-mark resting rule must remain');
});

test('the neighbouring first-run hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.first-run button:hover:not\(:disabled\), \.fixture-demo-banner button:hover\s*\{[^}]*background:\s*#eaf3f4/), 'the first-run button hover must remain');
  assert.ok(styleCss.match(/\.first-run-docs a:hover\s*\{[^}]*background:\s*#eaf3f4/), 'slice 63 docs-link hover must remain');
  assert.ok(styleCss.match(/\.first-run summary:hover\s*\{[^}]*background:\s*#eaf3f4/), 'slice 70 summary hover must remain');
});

describe('first-run header brand hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${styleCss}</style>`
      + `<div class="first-run"><header class="first-run-header"><a id="brand" class="brand" href="./"><span class="brand-wordmark">opensight</span></a><span>Open-source business intelligence</span></header></div>`
      + `<a id="outside" class="brand" href="./">Outside brand</a>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.first-run-header .brand:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const matches = (el, rule) => rule ? el.matches(rule.selectorText.replaceAll(':hover', '')) : null;
      return {
        found: !!found,
        brand: found ? measure(document.querySelector('#brand'), found) : null,
        outsideMatches: matches(document.querySelector('#outside'), found),
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.equal(actual.brand.rest.background, 'rgba(0, 0, 0, 0)', 'brand rest background');
    assert.equal(actual.brand.hovered.background, 'rgb(54, 87, 100)', 'brand hover background');
    assert.equal(actual.brand.rest.color, 'rgb(255, 255, 255)', 'brand rest color');
    assert.equal(actual.brand.hovered.color, actual.brand.rest.color, 'brand color unchanged');
    assert.equal(actual.brand.rest.box, actual.brand.hovered.box, 'brand geometry');
    assert.equal(actual.outsideMatches, false, 'a brand link outside .first-run-header must be out of scope');
  });
});
