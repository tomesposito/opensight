import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 64: hover feedback for inputs inside a
// collection card (.collection-card input in app-chrome.css) — the
// drafts search field (.draft-collection-tools input[type=search]) and
// the rename field (.draft-rename input) of the expanded LocalDrafts
// collection on the Analyses home page (LocalDrafts.tsx via
// Analyses.tsx inside CollectionPage's .collection-card). Static audit
// follow-on to slices 59-63: buttons in the same card tint
// (.collection-card button:hover -> #eaf4f4) and the pagination select
// tints (.collection-pagination select:hover -> #eaf3f7, slice 23), but
// no :hover rule in any stylesheet reached a .collection-card input —
// the search-input hover rules are scoped to .author-workspace /
// .data-page — and a real-mouse Chromium probe measured the search and
// rename fields white -> white on hover. The expanded collection only
// renders when local drafts exist, so empty-state route audits never
// reach these fields (the slices 50/62 blind spot). The fields now take
// #eaf3f7, the collection surface's own field hover tint (the slice-23
// pagination select in the same card). Background only, so resting
// geometry is identical. Static (no animation), so no reduced-motion
// variant is needed; radio/checkbox inputs are excluded so the
// favorites-filter checkbox keeps its native rendering (the
// data-dialog / admin-settings pattern), and file inputs likewise.
const css = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const inputHover = css.match(/\.collection-card input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\)\s*\{([^}]*)\}/);

test('the collection-card input hover rule exists with the collection field tint', () => {
  assert.ok(inputHover, 'expected the collection-card input hover rule');
  assert.match(inputHover[1], /background:\s*#eaf3f7/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(inputHover, 'expected the collection-card input hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(inputHover[1]), 'hover must change background only');
});

test('the resting collection-card rules are preserved', () => {
  const input = css.match(/^\.collection-card input\s*\{([^}]*)\}/m);
  assert.ok(input, 'expected the collection-card input resting rule');
  assert.match(input[1], /min-width:\s*0/);
  const shared = css.match(/\.collection-card button, \.collection-card select, \.collection-card input\s*\{([^}]*)\}/);
  assert.ok(shared, 'expected the shared collection-card control resting rule');
  assert.match(shared[1], /background:\s*#fff/);
});

test('the neighbouring collection hover rules are untouched', () => {
  assert.ok(css.match(/\.collection-card button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf4f4/), 'the collection-card button hover rule must still be present');
  assert.ok(css.match(/\.collection-pagination select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection-pagination select hover rule must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="collection-card">
      <div class="draft-collection-tools"><label>Search analyses<input id="search" type="search" /></label></div>
      <form class="draft-rename"><label>Draft name<input id="rename" value="Q3 sales" /></label></form>
      <input id="off" disabled />
      <label class="favorites-filter"><input id="fav" type="checkbox" />Favorites only</label>
    </div>`);
    const actual = await page.evaluate(() => {
      let found;
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '').replaceAll('"', '') === '.collection-card input:hover:not(:disabled):not([type=radio]):not([type=checkbox]):not([type=file])') found = rule;
        }
      }
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const plain = found ? found.selectorText.replace(':hover', '') : null;
      return {
        search: found ? measure(document.querySelector('#search'), found) : null,
        rename: found ? measure(document.querySelector('#rename'), found) : null,
        offMatches: plain ? document.querySelector('#off').matches(plain) : null,
        favMatches: plain ? document.querySelector('#fav').matches(plain) : null,
      };
    });
    assert.ok(actual.search, 'expected the input hover rule in the CSSOM');
    assert.equal(actual.search.rest.background, 'rgb(255, 255, 255)', 'search rest');
    assert.equal(actual.search.hovered.background, 'rgb(234, 243, 247)', 'search hover');
    assert.equal(actual.search.rest.box, actual.search.hovered.box, 'search geometry');
    assert.equal(actual.rename.hovered.background, 'rgb(234, 243, 247)', 'rename hover');
    assert.equal(actual.rename.rest.box, actual.rename.hovered.box, 'rename geometry');
    assert.equal(actual.offMatches, false, 'disabled inputs must be excluded from the hover rule');
    assert.equal(actual.favMatches, false, 'checkbox inputs must be excluded from the hover rule');
  });
}
