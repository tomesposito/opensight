import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 125: hover feedback for the drafts collection
// tools row's plain search label (.draft-collection-tools label —
// "Search analyses" in LocalDrafts.tsx's expanded collection, wrapping
// the search input in the tools row on the Analyses home page). The
// resting rule (.draft-collection-tools label { display: grid; gap: 4px;
// }) makes the label a visible surface (text, gap, field), but the label
// had zero hover feedback: slice 64 hovered the search field inside this
// label, slice 96 the favorites-filter label beside it, slice 124 the
// pagination label below it, and every other label :hover rule in the
// cascade is scoped elsewhere (author labels, calculation/analysis-file/
// data dialogs, prep labels, connector/sign-in labels, admin labels,
// embed labels, the collection pagination label). A CSSOM probe with all
// five real stylesheets (1,394 rules) in the real ancestor context
// (app-shell > main > .analyses-home > section.collection-page >
// .collection-card > section.local-drafts.draft-collection >
// .draft-collection-tools > label) confirmed zero matching :hover rules
// for the label and a transparent rest, while the search input inside it
// matched the slice-64 collection-card field hover and the
// favorites-filter label beside it matched the slice-96 hover. The label
// now takes #eaf3f7, the collection surface's established hover tint
// (the search field inside it and the favorites-filter label beside it),
// so no new colour is introduced — and because the label and the field
// inside it take the same tint, hovering either reads as one surface,
// not two steps. The favorites-filter label is excluded from the new
// rule: slice 96 already owns its hover (same tint, plus its author
// dark-chrome variant). This label exists only in the expanded
// collection — the author sidebar renders LocalDrafts without the tools
// row — and that surface is fixed light, so no dark variant. Background
// only, so resting geometry is identical and there is no animation.
const appChromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = appChromeCss.match(/^\.draft-collection-tools label:hover:not\(\.favorites-filter\)\s*\{([^}]*)\}/m);

test('the collection search label hover rule exists and uses the established hover tint', () => {
  assert.ok(labelRule, 'expected the draft-collection-tools label :hover rule');
  assert.match(labelRule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the search field and favorites-filter hovers, so no new colour is introduced', () => {
  assert.ok(appChromeCss.match(/\.collection-card input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection-card field hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.favorites-filter:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the favorites-filter label hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.collection-pagination label:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the collection pagination label hover must remain #eaf3f7');
});

test('the collection search label hover rule is paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(labelRule, 'expected the draft-collection-tools label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting draft-collection tools rules are preserved', () => {
  assert.ok(appChromeCss.match(/\.draft-collection-tools\s*\{[^}]*display:\s*flex/), 'the resting tools row rule must remain');
  assert.ok(appChromeCss.match(/\.draft-collection-tools label\s*\{[^}]*display:\s*grid[^}]*gap:\s*4px/), 'the resting tools label rule must remain');
  assert.ok(appChromeCss.match(/\.draft-collection-tools label\.favorites-filter\s*\{[^}]*display:\s*inline-flex/), 'the resting favorites-filter label rule must remain');
});

describe('Collection search label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry in the real ancestor context, and the favorites-filter and outside labels are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="app-shell"><main><div class="analyses-home"><section class="collection-page"><div class="collection-card"><section class="local-drafts draft-collection"><div class="draft-collection-tools"><label class="favorites-filter" id="favLabel"><input type="checkbox">Favorites only</label><label id="searchLabel">Search analyses<input type="search"></label><button type="button">Refresh drafts</button></div></section></div></section></div></main></div>`
      + `<label id="outsideLabel">Outside<input type="search"></label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const label = all.find(r => norm(r) === '.draft-collection-tools label:hover:not(.favorites-filter)') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        found: !!label,
        props: label ? [...label.style] : [],
        searchLabel: label ? measure(el('searchLabel'), label) : null,
        favLabelMatches: label ? el('favLabel').matches(label.selectorText.replaceAll(':hover', '')) : null,
        outsideLabelMatches: label ? el('outsideLabel').matches(label.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.equal(actual.found, true, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.searchLabel.rest.background, 'rgba(0, 0, 0, 0)', 'search label rest');
    assert.equal(actual.searchLabel.hovered.background, 'rgb(234, 243, 247)', 'search label hover');
    assert.notEqual(actual.searchLabel.rest.background, actual.searchLabel.hovered.background);
    assert.equal(actual.searchLabel.rest.color, actual.searchLabel.hovered.color, 'search label colour unchanged on hover');
    assert.equal(actual.searchLabel.rest.box, actual.searchLabel.hovered.box, 'search label geometry');
    assert.equal(actual.favLabelMatches, false, 'the favorites-filter label must stay owned by its slice-96 hover rule');
    assert.equal(actual.outsideLabelMatches, false, 'a label outside .draft-collection-tools must be out of scope');
  });
});
