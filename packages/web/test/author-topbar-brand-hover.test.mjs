import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 89: hover feedback for the standalone author
// topbar's brand link (Author.tsx — a plain <a class="brand"> inside
// header.author-topbar.app-header in .author-workspace, rendered only
// when the author is not embedded in the app shell and no identity
// renderer is supplied). The other two brand-link instances already
// hover — .product-header .brand:hover and .first-run-header
// .brand:hover (slice 71), both #365764 — but each is scoped to its
// own header, every other a:hover rule is scoped elsewhere, and the
// author generic hovers are button/input/select/textarea/
// summary-typed, so this link matched no :hover rule. A CSSOM probe
// with all five real stylesheets (1,341 rules) in the real ancestor
// context confirmed zero matching :hover rules and a transparent
// rest. It now takes the brand links' established dark-header hover
// tint (#365764). The header variables are shared by both editor
// chromes, so no dark variant is added. Background only, so resting
// colour and geometry are unchanged.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const appChromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const rule = css.match(/^\.author-topbar \.brand:hover\s*\{([^}]*)\}/m);

test('the author-topbar brand hover rule exists and uses the brand hover tint', () => {
  assert.ok(rule, 'expected the .author-topbar .brand:hover rule');
  assert.match(rule[1], /background:\s*#365764/);
});

test('the hover tint matches the other brand-link hovers, so no new colour is introduced', () => {
  assert.ok(appChromeCss.match(/\.product-header\s+\.brand:hover\s*\{[^}]*background:\s*#365764/), 'the product-header brand hover must remain #365764');
  assert.ok(css.match(/\.first-run-header\s+\.brand:hover\s*\{[^}]*background:\s*#365764/), 'the first-run brand hover must remain #365764');
});

test('the brand hover rule is paint-only: resting geometry and link presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:|text-decoration/.test(rule[1]), 'hover must change background only');
});

test('the resting author-topbar rules are preserved', () => {
  assert.ok(css.match(/\.author-workspace \.author-topbar\s*\{[^}]*background:\s*var\(--header-bg\)/), 'the author topbar resting rule must remain');
  assert.ok(css.match(/\.author-topbar \.brand\s*\{[^}]*color:\s*var\(--header-text\)/), 'the brand resting colour must remain');
  assert.ok(css.match(/\.author-topbar \.brand-mark\s*\{[^}]*color:\s*var\(--header-muted\)/), 'the brand-mark resting rule must remain');
});

describe('Author-topbar brand hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry, and brand links outside .author-topbar are out of scope', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<div class="author-workspace" data-chrome="light"><header class="author-topbar app-header">`
      + `<a id="target" class="brand" href="./"><span class="brand-mark" aria-hidden="true">O</span><span class="brand-wordmark">opensight</span></a>`
      + `</header></div>`
      + `<a id="outside" class="brand" href="./">Outside brand</a>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.author-topbar .brand:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const outside = document.querySelector('#outside');
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        target: found ? measure(document.querySelector('#target'), found) : null,
        outsideMatches: found ? outside.matches(found.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.target.rest.background, 'rgba(0, 0, 0, 0)', 'author-topbar brand rest');
    assert.equal(actual.target.hovered.background, 'rgb(54, 87, 100)', 'author-topbar brand hover');
    assert.notEqual(actual.target.rest.background, actual.target.hovered.background);
    assert.equal(actual.target.rest.color, 'rgb(255, 255, 255)', 'author-topbar brand keeps its header text colour at rest');
    assert.equal(actual.target.rest.color, actual.target.hovered.color, 'author-topbar brand colour unchanged on hover');
    assert.equal(actual.target.rest.box, actual.target.hovered.box, 'author-topbar brand geometry');
    assert.equal(actual.outsideMatches, false, 'a brand link outside .author-topbar must be out of scope');
  });
});
