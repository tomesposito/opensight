import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 73: hover feedback for the left rail's
// current-page link (.product-navigation .app-nav a[aria-current] in
// AppNavigation.tsx). Its resting selected background is #dceff0 — the
// exact tint the generic rail hover paints — and the [aria-current] rule
// ties the hover rule at (0,3,1) and stands after it, so hovering the
// current link changed nothing on any route, while every other rail link
// steps transparent -> #dceff0. A fresh whole-demo behavioral audit (real
// mouse + computed-style delta) flagged it on every route audited.
// Following the slices 28/29 selected-control language, the current link
// now takes a dedicated hover step: #cddde0, one visible step deeper than
// #dceff0 and already in the palette (the author-canvas dot grid). The
// selector's (0,4,1) specificity beats both the generic hover and the
// resting selected rule. Background only, so the selected border, teal
// text and weight are unchanged and resting geometry is identical.
const appChromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const rule = appChromeCss.match(/\.product-navigation\s+\.app-nav\s+a\[aria-current\]:hover\s*\{([^}]*)\}/);

test('the current rail link has a hover state one step deeper than its selected tint', () => {
  assert.ok(rule, 'expected the .product-navigation .app-nav a[aria-current]:hover rule');
  assert.match(rule[1], /background:\s*#cddde0/);
});

test('the hover tint is an existing palette color and differs from both rail tints', () => {
  assert.ok(styleCss.match(/\.author-canvas\s*\{[^}]*#cddde0/), 'the canvas dot grid must keep #cddde0 in the palette');
  assert.ok(appChromeCss.match(/\.product-navigation \.app-nav a:hover\s*\{[^}]*background:\s*#dceff0/), 'the generic rail hover must remain #dceff0');
  assert.ok(appChromeCss.match(/\.product-navigation \.app-nav a\[aria-current\]\s*\{[^}]*background:\s*#dceff0/), 'the resting selected background must remain #dceff0');
});

test('the current-link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting current-link rule is preserved', () => {
  assert.ok(appChromeCss.match(/\.product-navigation \.app-nav a\[aria-current\]\s*\{[^}]*border-color:\s*#157f88[^}]*background:\s*#dceff0[^}]*color:\s*#126e76[^}]*font-weight:\s*600/), 'the resting selected rule must remain');
});

test('the neighbouring rail hovers are untouched', () => {
  assert.ok(appChromeCss.match(/\.product-navigation \.rail-search:hover, \.product-navigation \.rail-more:hover,\s*\.product-navigation \.app-nav a:hover\s*\{\s*background:\s*#dceff0/), 'the generic rail hover must remain');
  assert.ok(appChromeCss.match(/\.rail-recents a:hover\s*\{[^}]*color:\s*#126e76/), 'the recents link hover must remain');
  assert.ok(appChromeCss.match(/\.app-shell \.workspace-banner button:hover:not\(:disabled\)\s*\{\s*background:\s*#dceff0/), 'the slice 62 workspace-banner hover must remain');
});

describe('current rail link hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${styleCss}</style><style>${appChromeCss}</style>`
      + `<aside class="product-navigation"><nav class="app-nav" aria-label="Product"><a id="plain" href="#/home">Home</a><a id="current" href="#/analyses" aria-current="page">Analyses</a></nav></aside>`
      + `<p><a id="outside" href="#/home" aria-current="page">Outside the rail</a></p>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.product-navigation .app-nav a[aria-current]:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, weight: getComputedStyle(el).fontWeight, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, weight: getComputedStyle(el).fontWeight, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const matches = (el, rule) => rule ? el.matches(rule.selectorText.replaceAll(':hover', '')) : null;
      return {
        found: !!found,
        current: found ? measure(document.querySelector('#current'), found) : null,
        plainMatches: matches(document.querySelector('#plain'), found),
        outsideMatches: matches(document.querySelector('#outside'), found),
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.equal(actual.current.rest.background, 'rgb(220, 239, 240)', 'current link rest background');
    assert.equal(actual.current.hovered.background, 'rgb(205, 221, 224)', 'current link hover background');
    assert.equal(actual.current.hovered.color, actual.current.rest.color, 'current link color unchanged');
    assert.equal(actual.current.hovered.weight, actual.current.rest.weight, 'current link weight unchanged');
    assert.equal(actual.current.rest.box, actual.current.hovered.box, 'current link geometry');
    assert.equal(actual.plainMatches, false, 'a non-current rail link must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a current link outside the rail must be out of scope');
  });
});
