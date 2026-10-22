import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 96: hover feedback for the drafts collection's
// "Favorites only" label (label.favorites-filter in LocalDrafts.tsx,
// wrapping its checkbox in the draft-collection tools row on the Analyses
// home page, and again in the author sidebar's local-drafts panel). It had
// zero hover feedback. Every :hover rule that reaches its row is scoped
// elsewhere or excludes it — the collection-card field hover (slice 64)
// deliberately excludes checkbox inputs so native controls keep their OS
// rendering, and the card button hover is button-typed — so neither the
// label nor its checkbox matched any :hover rule, while the search field
// beside it (slice 64) and the Refresh drafts button do step. A CSSOM
// probe with all five real stylesheets (1,348 rules) in the real ancestor
// contexts (app-shell > main > .analyses-home > .collection-page >
// .collection-card > .draft-collection > .draft-collection-tools, and the
// author sidebar's details.local-drafts in both chromes) confirmed zero
// matching :hover rules and a transparent rest in all three. The label
// now takes #eaf3f7, the collection surface's established field hover tint
// (the slice-64 search field beside it and the slice-23 pagination select
// in the same card), so no new colour is introduced. The rule is on the
// label, not the checkbox: the checkbox keeps its native rendering,
// following the slice-94 connector-toggle and slice-95 sign-in-check
// precedents where the label surface hovers and its inner input does not.
// The author dark-chrome variant takes the author dark hover tint
// (#334c62, the dark button and summary hovers), as in slices 36/37/38.
// Background only, so resting geometry is identical and there is no
// animation.
const appCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = appCss.match(/^\.favorites-filter:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.favorites-filter:hover\s*\{([^}]*)\}/m);

test('the favorites-filter hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .favorites-filter :hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the collection field and pagination select hovers, so no new colour is introduced', () => {
  assert.ok(appCss.match(/\.collection-card input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection-card field hover must remain #eaf3f7');
  assert.ok(appCss.match(/\.collection-pagination select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the pagination select hover must remain #eaf3f7');
});

test('the favorites-filter hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting favorites-filter rule is preserved, the checkbox has no hover rule of its own, and the dark variant uses the author dark hover tint', () => {
  assert.ok(appCss.match(/\.draft-collection-tools label\.favorites-filter\s*\{[^}]*display:\s*inline-flex[^}]*white-space:\s*nowrap/), 'the favorites-filter resting rule must remain');
  assert.ok(!/\.favorites-filter input:hover/.test(appCss + styleCss), 'the checkbox must keep its native rendering with no hover rule of its own');
  assert.ok(!/\.favorites-filter:hover[^{]*\{[^}]*input/.test(appCss), 'the label hover rule must not target the checkbox');
  assert.ok(darkRule, 'expected the author dark-chrome favorites-filter hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark button hover must remain #334c62');
});

describe('Favorites-filter hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the collection and dark author contexts, and the checkbox and outside labels are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="app-shell"><main><div class="analyses-home"><section class="collection-page"><div class="collection-card">`
      + `<section class="local-drafts draft-collection"><div class="draft-collection-tools">`
      + `<label class="favorites-filter" id="favLabel"><input id="favBox" type="checkbox">Favorites only</label>`
      + `</div></section></div></section></div></main></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-tools"><details class="local-drafts" open><summary>Local drafts (1)</summary>`
      + `<label class="favorites-filter" id="favDark"><input type="checkbox">Favorites only</label></details></div></div>`
      + `<label id="outsideLabel"><input type="checkbox">Other filter</label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.favorites-filter:hover') ?? null;
      const darkFound = all.find(r => (r.selectorText || '').replaceAll('"', '') === '.author-workspace[data-chrome=dark] .favorites-filter:hover') ?? null;
      const label = document.querySelector('#favLabel');
      const darkLabel = document.querySelector('#favDark');
      const box = document.querySelector('#favBox');
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const bare = found ? found.selectorText.replaceAll(':hover', '') : '';
      const darkBare = darkFound ? darkFound.selectorText.replaceAll(':hover', '') : '';
      return {
        found: !!found,
        darkFound: !!darkFound,
        props: found ? [...found.style] : [],
        darkProps: darkFound ? [...darkFound.style] : [],
        label: found ? measure(label, found) : null,
        darkLabel: darkFound ? measure(darkLabel, darkFound) : null,
        boxMatches: found ? box.matches(bare) : null,
        darkBoxMatches: darkFound ? darkLabel.querySelector('input').matches(darkBare) : null,
        outsideMatches: found ? document.querySelector('#outsideLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.darkFound, 'expected the dark-chrome hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.ok(actual.darkProps.length && actual.darkProps.every(p => p.startsWith('background')), 'dark hover rule must set background longhands only');
    assert.equal(actual.label.rest.background, 'rgba(0, 0, 0, 0)', 'favorites-filter label rest (transparent)');
    assert.equal(actual.label.hovered.background, 'rgb(234, 243, 247)', 'favorites-filter label hover');
    assert.notEqual(actual.label.rest.background, actual.label.hovered.background);
    assert.equal(actual.label.rest.color, actual.label.hovered.color, 'favorites-filter label colour unchanged on hover');
    assert.equal(actual.label.rest.box, actual.label.hovered.box, 'favorites-filter label geometry');
    assert.equal(actual.darkLabel.rest.background, 'rgba(0, 0, 0, 0)', 'dark favorites-filter label rest (transparent)');
    assert.equal(actual.darkLabel.hovered.background, 'rgb(51, 76, 98)', 'dark favorites-filter label hover');
    assert.equal(actual.darkLabel.rest.color, actual.darkLabel.hovered.color, 'dark favorites-filter label colour unchanged on hover');
    assert.equal(actual.darkLabel.rest.box, actual.darkLabel.hovered.box, 'dark favorites-filter label geometry');
    assert.equal(actual.boxMatches, false, 'the checkbox inside .favorites-filter must be out of scope');
    assert.equal(actual.darkBoxMatches, false, 'the checkbox inside the dark .favorites-filter must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a label outside .favorites-filter must be out of scope');
  });
});
