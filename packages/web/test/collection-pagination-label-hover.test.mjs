import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 124: hover feedback for the drafts
// collection's pagination label (.collection-pagination label —
// "Items per page" in LocalDrafts.tsx's expanded collection, wrapping
// the page-size select in the pagination row on the Analyses home
// page). The resting rule (.collection-pagination label { display:
// flex; align-items: center; gap: 8px; }) makes the label a visible
// surface (text, gap, select), but the label had zero hover feedback:
// slice 23 hovered the select inside this label, slice 64 the
// collection card's fields, slice 96 the neighbouring favorites-filter
// label, and every other label :hover rule in the cascade is scoped
// elsewhere (author labels, calculation/analysis-file/data dialogs,
// prep labels, connector/sign-in labels, admin labels, embed labels,
// the dialog pagination label). A CSSOM probe with all five real
// stylesheets (1,393 rules) in the real ancestor context (app-shell >
// main > .analyses-home > section.collection-page > .collection-card >
// section.local-drafts.draft-collection > .collection-pagination >
// label) confirmed zero matching :hover rules for the label and a
// transparent rest, while the select inside it matched the slice-23
// pagination select hover. The label now takes #eaf3f7, the collection
// surface's established hover tint (the pagination select inside it
// and the collection-card field hover), so no new colour is
// introduced — and because the label and the select inside it take
// the same tint, hovering either reads as one surface, not two steps.
// Background only, so resting geometry is identical and there is no
// animation; the collection surface is fixed light, so no dark
// variant.
const appChromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = appChromeCss.match(/^\.collection-pagination label:hover\s*\{([^}]*)\}/m);

test('the collection pagination label hover rule exists and uses the established hover tint', () => {
  assert.ok(labelRule, 'expected the collection-pagination label :hover rule');
  assert.match(labelRule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the pagination select and collection-card field hovers, so no new colour is introduced', () => {
  assert.ok(appChromeCss.match(/\.collection-pagination select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the pagination select hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.collection-card input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection-card field hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.favorites-filter:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the favorites-filter label hover must remain #eaf3f7');
});

test('the collection pagination label hover rule is paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(labelRule, 'expected the collection-pagination label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting collection pagination rules are preserved', () => {
  assert.ok(appChromeCss.match(/\.collection-pagination\s*\{[^}]*display:\s*flex/), 'the resting pagination row rule must remain');
  assert.ok(appChromeCss.match(/\.collection-pagination label\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*gap:\s*8px/), 'the resting pagination label rule must remain');
  assert.ok(appChromeCss.match(/\.collection-pagination button\s*\{[^}]*min-width:\s*28px/), 'the resting pagination button rule must remain');
});

describe('Collection pagination label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry in the real ancestor context, and labels outside the pagination row are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="app-shell"><main><div class="analyses-home"><section class="collection-page"><div class="collection-card"><section class="local-drafts draft-collection"><div class="collection-pagination"><span>3 analyses</span><label id="pagLabel">Items per page<select><option>25</option><option>50</option></select></label><button type="button">‹</button><span>Page 1 of 1</span></div></section></div></section></div></main></div>`
      + `<div class="app-shell"><main><div class="collection-card"><label id="cardLabel">Outside pagination<select><option>Other</option></select></label></div></main></div>`
      + `<label id="outsideLabel">Outside<select><option>Other</option></select></label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const label = all.find(r => norm(r) === '.collection-pagination label:hover') ?? null;
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
        pagLabel: label ? measure(el('pagLabel'), label) : null,
        cardLabelMatches: label ? el('cardLabel').matches(label.selectorText.replaceAll(':hover', '')) : null,
        outsideLabelMatches: label ? el('outsideLabel').matches(label.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.equal(actual.found, true, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.pagLabel.rest.background, 'rgba(0, 0, 0, 0)', 'pagination label rest');
    assert.equal(actual.pagLabel.hovered.background, 'rgb(234, 243, 247)', 'pagination label hover');
    assert.notEqual(actual.pagLabel.rest.background, actual.pagLabel.hovered.background);
    assert.equal(actual.pagLabel.rest.color, actual.pagLabel.hovered.color, 'pagination label colour unchanged on hover');
    assert.equal(actual.pagLabel.rest.box, actual.pagLabel.hovered.box, 'pagination label geometry');
    assert.equal(actual.cardLabelMatches, false, 'a label inside .collection-card but outside .collection-pagination must be out of scope');
    assert.equal(actual.outsideLabelMatches, false, 'a label outside .collection-pagination must be out of scope');
  });
});
