import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 74: hover feedback for a section nav's
// current link (.section-nav a[aria-current] in AppNavigation.tsx) in
// both of its contexts — the top section nav (.app-shell >
// .section-nav, Data) and the rail's section groups
// (.product-navigation .section-nav, Analyses/Admin/Developer tools).
// Its resting selected background is #eaf4f4 — the exact tint the
// generic nav hover paints — and both rules tie at (0,2,1), so
// hovering the current link changed nothing on any route, while every
// plain section link steps transparent -> #eaf4f4. app-chrome.css adds
// no section-nav link background (only padding, border and radius), so
// the style.css cascade governs both contexts. Following the slices
// 28/29 selected-control language (and slice 73 for the rail's app-nav
// current link), the current link now takes a dedicated hover step:
// #dceff0, one visible step deeper than #eaf4f4 and already in the
// palette (the rail hover/selected tint). The selector's (0,3,1)
// specificity beats both the generic hover and the resting selected
// rule. Scope is .section-nav only: .app-nav renders only inside the
// rail, where slice 73's rule already governs its current link.
// Background only, so the selected border and teal text are unchanged
// and resting geometry is identical.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const appChromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const rule = styleCss.match(/\.section-nav\s+a\[aria-current\]:hover\s*\{([^}]*)\}/);

test('the current section link has a hover state one step deeper than its selected tint', () => {
  assert.ok(rule, 'expected the .section-nav a[aria-current]:hover rule');
  assert.match(rule[1], /background:\s*#dceff0/);
});

test('the hover tint is an existing palette color and differs from the section tint', () => {
  assert.ok(appChromeCss.match(/\.product-navigation \.app-nav a\[aria-current\]\s*\{[^}]*background:\s*#dceff0/), 'the rail selected tint must keep #dceff0 in the palette');
  assert.ok(styleCss.match(/\.app-nav a:hover, \.section-nav a:hover\s*\{\s*background:\s*#eaf4f4/), 'the generic nav hover must remain #eaf4f4');
  assert.ok(styleCss.match(/\.app-nav a\[aria-current\], \.section-nav a\[aria-current\]\s*\{[^}]*background:\s*#eaf4f4/), 'the resting selected background must remain #eaf4f4');
});

test('the current-link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting current-link rule is preserved', () => {
  assert.ok(styleCss.match(/\.app-nav a\[aria-current\], \.section-nav a\[aria-current\]\s*\{\s*color:\s*#126e76;\s*border-color:\s*#157f88;\s*background:\s*#eaf4f4/), 'the resting selected rule must remain');
});

test('the neighbouring nav hovers are untouched', () => {
  assert.ok(styleCss.match(/\.app-nav a:hover, \.section-nav a:hover\s*\{\s*background:\s*#eaf4f4/), 'the generic nav hover must remain');
  assert.ok(appChromeCss.match(/\.product-navigation \.app-nav a\[aria-current\]:hover\s*\{\s*background:\s*#cddde0/), 'the slice 73 rail current-link hover must remain');
  assert.ok(appChromeCss.match(/\.product-navigation \.section-nav a\s*\{[^}]*border-radius:\s*4px/), 'the rail section-nav link layout must remain');
  assert.ok(appChromeCss.match(/\.app-shell > \.section-nav a, \.app-shell > \.admin-navigation \.section-nav a\s*\{[^}]*padding:\s*8px 0/), 'the top section-nav link layout must remain');
});

describe('current section link hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry in both contexts', async () => {
    await page.setContent(`<style>${styleCss}</style><style>${appChromeCss}</style>`
      + `<div class="app-shell"><nav class="section-nav" aria-label="Data"><a id="top-plain" href="#/data">Data sources</a><a id="top-current" href="#/data/preparation" aria-current="page">Preparation</a></nav>`
      + `<aside class="product-navigation"><nav class="section-nav" aria-label="Admin"><a id="rail-plain" href="#/admin/users">Users</a><a id="rail-current" href="#/admin/security" aria-current="page">Security</a></nav></aside>`
      + `<p><a id="outside" href="#/home" aria-current="page">Outside any section nav</a></p></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.section-nav a[aria-current]:hover') ?? null;
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
        top: found ? measure(document.querySelector('#top-current'), found) : null,
        rail: found ? measure(document.querySelector('#rail-current'), found) : null,
        plainMatches: matches(document.querySelector('#top-plain'), found),
        outsideMatches: matches(document.querySelector('#outside'), found),
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    for (const ctx of ['top', 'rail']) {
      assert.equal(actual[ctx].rest.background, 'rgb(234, 244, 244)', `${ctx} current link rest background`);
      assert.equal(actual[ctx].hovered.background, 'rgb(220, 239, 240)', `${ctx} current link hover background`);
      assert.equal(actual[ctx].hovered.color, actual[ctx].rest.color, `${ctx} current link color unchanged`);
      assert.equal(actual[ctx].rest.box, actual[ctx].hovered.box, `${ctx} current link geometry`);
    }
    assert.equal(actual.plainMatches, false, 'a non-current section link must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a current link outside a section nav must be out of scope');
  });
});
