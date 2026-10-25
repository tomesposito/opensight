import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 final audit: the global search dialog's empty-state
// primary button (.global-search .search-empty .primary-button —
// "Create analysis" in GlobalSearch.tsx, shown when the account has
// no assets yet). The exhaustive final audit (static extraction of
// every interactive element in packages/web/src, contexts resolved
// through the component graph, computed style at rest vs hover in
// Chromium with all five shipped stylesheets) found the button was
// both unpainted and inert inside the dialog: every .primary-button
// rule in the cascade is scoped to another context (analyses home,
// author workspace, calculation dialog, empty-page state, collection
// cards), so here it rested at the UA default grey and hovering
// changed nothing — while the dialog's own header button, search
// input, type chips and result rows all carry hover states. The
// button now takes the standard primary paint (#157f88, white text,
// the empty-page-state primary's padding/radius) and the standard
// primary hover deepening (#126e76) used by every other context, so
// no new colour is introduced. The dialog is a fixed-light surface,
// so no dark variant.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const restRule = styleCss.match(/^\.global-search \.search-empty \.primary-button\s*\{([^}]*)\}/m);
const hoverRule = styleCss.match(/^\.global-search \.search-empty \.primary-button:hover\s*\{([^}]*)\}/m);

test('the global-search primary button resting rule paints the standard primary treatment', () => {
  assert.ok(restRule, 'expected the global-search primary-button resting rule');
  assert.match(restRule[1], /background:\s*#157f88/);
  assert.match(restRule[1], /color:\s*#fff/);
});

test('the global-search primary button hover rule deepens to the standard primary hover', () => {
  assert.ok(hoverRule, 'expected the global-search primary-button :hover rule');
  assert.match(hoverRule[1], /background:\s*#126e76/);
  assert.match(hoverRule[1], /border-color:\s*#126e76/);
});

test('the paint matches the other primary contexts, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.analyses-home \.primary-button\s*\{[^}]*background:\s*#157f88/), 'the analyses-home primary must remain #157f88');
  assert.ok(styleCss.match(/\.analyses-home \.primary-button:hover\s*\{[^}]*background:\s*#126e76/), 'the analyses-home primary hover must remain #126e76');
});

test('the neighbouring global-search rules are preserved', () => {
  assert.ok(styleCss.match(/\.global-search \.search-empty\s*\{[^}]*padding:\s*8px 16px 16px/), 'the search-empty layout rule must remain');
  assert.ok(styleCss.match(/\.global-search li:hover\s*\{[^}]*background:\s*var\(--palette-selected\)/), 'the search-row hover must remain');
});

describe('Global-search primary button in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('the button rests painted as a primary and deepens on hover with identical geometry, and primary buttons outside the search empty state are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<dialog class="global-search" open><div class="search-empty"><p>No analyses yet.</p>`
      + `<button type="button" class="primary-button" id="searchPrimary">Create analysis</button></div></dialog>`
      + `<button type="button" class="primary-button" id="outsidePrimary">Outside</button>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const hover = all.find(r => norm(r) === '.global-search .search-empty .primary-button:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        found: !!hover,
        search: hover ? measure(el('searchPrimary'), hover) : null,
        outsideMatches: hover ? el('outsidePrimary').matches(hover.selectorText.replaceAll(':hover', '')) : null,
        outsideRest: getComputedStyle(el('outsidePrimary')).backgroundColor,
      };
    });
    assert.equal(actual.found, true, 'expected the global-search primary-button hover rule in the CSSOM');
    assert.equal(actual.search.rest.background, 'rgb(21, 127, 136)', 'searchPrimary rests at the primary paint, not the UA grey');
    assert.equal(actual.search.rest.color, 'rgb(255, 255, 255)', 'searchPrimary rest text');
    assert.equal(actual.search.hovered.background, 'rgb(18, 110, 118)', 'searchPrimary hover');
    assert.equal(actual.search.rest.box, actual.search.hovered.box, 'searchPrimary geometry');
    assert.equal(actual.outsideMatches, false, 'a primary button outside the search empty state must be out of scope');
  });
});
