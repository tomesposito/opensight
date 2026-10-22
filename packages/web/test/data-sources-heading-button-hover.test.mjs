import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 92: hover feedback for the data-sources
// heading's "Prepare data" button (.app-shell .data-sources-heading
// > button in DataSources.tsx — section.data-sources inside
// .app-shell > main). It is a primary button (app-chrome.css rests
// it #157f88 with white text), but every button:hover rule in the
// cascade is scoped elsewhere — author, data-page/data-dialog,
// admin, collection, the product-header account panel, the
// workspace banner, the empty-page primary, the connector-submit
// in this same gallery — so it matched no :hover rule. A CSSOM
// probe with all five real stylesheets (1,344 rules) in the real
// ancestor context confirmed zero matching :hover rules and a
// #157f88 rest, while the gallery's search input (slice 90),
// details fields (slice 91) and submit (slice 66) do step. It now
// takes the app-wide primary hover step (#157f88 -> #126e76,
// slices 51/57/59/66), so no new colour is introduced. Background
// only, so resting geometry is identical and there is no
// animation. The gallery is a fixed-light app-shell surface, so
// no dark variant is added.
const css = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const rule = css.match(/^\.app-shell \.data-sources-heading > button:hover:not\(:disabled\)\s*\{([^}]*)\}/m);

test('the data-sources heading button hover rule exists and uses the primary hover step', () => {
  assert.ok(rule, 'expected the .data-sources-heading > button :hover rule');
  assert.match(rule[1], /background:\s*#126e76/);
});

test('the hover tint matches the connector-submit and account-panel primary hovers, so no new colour is introduced', () => {
  assert.ok(css.match(/\.app-shell \.connector-details button\.connector-submit:hover:not\(:disabled\)\s*\{[^}]*background:\s*#126e76/), 'the connector-submit hover must remain #126e76');
  assert.ok(css.match(/\.product-header \.account-menu \.account-panel button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#126e76/), 'the account-panel button hover must remain #126e76');
});

test('the heading button hover rule is paint-only: resting geometry and button presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting data-sources heading button rule is preserved', () => {
  assert.ok(css.match(/\.app-shell \.data-sources-heading > button\s*\{[^}]*background:\s*#157f88/), 'the heading button resting background must remain #157f88');
  assert.ok(css.match(/\.app-shell \.data-sources-heading > button\s*\{[^}]*color:\s*#fff/), 'the heading button resting label colour must remain white');
  assert.ok(css.match(/\.app-shell \.connector-submit\s*\{[^}]*background:\s*#157f88/), 'the app-shell connector-submit resting rule must remain');
});

describe('Data-sources heading button hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry, and buttons outside .data-sources-heading and disabled buttons are out of scope', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<div class="app-shell"><main><section class="data-sources">`
      + `<div class="data-sources-heading"><div><h1 id="data-sources-title">Create a data set</h1></div><button id="targetBtn">Prepare data</button></div>`
      + `<div class="data-sources-heading"><button id="disabledBtn" disabled>Prepare data</button></div>`
      + `</section></main></div>`
      + `<button id="outsideBtn">Prepare data</button>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '').includes('.data-sources-heading > button:hover')) ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const bare = found ? found.selectorText.replaceAll(':hover', '') : '';
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        target: found ? measure(document.querySelector('#targetBtn'), found) : null,
        disabledMatches: found ? document.querySelector('#disabledBtn').matches(bare) : null,
        outsideMatches: found ? document.querySelector('#outsideBtn').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.target.rest.background, 'rgb(21, 127, 136)', 'heading button rest');
    assert.equal(actual.target.hovered.background, 'rgb(18, 110, 118)', 'heading button hover');
    assert.notEqual(actual.target.rest.background, actual.target.hovered.background);
    assert.equal(actual.target.rest.color, actual.target.hovered.color, 'heading button colour unchanged on hover');
    assert.equal(actual.target.rest.box, actual.target.hovered.box, 'heading button geometry');
    assert.equal(actual.disabledMatches, false, 'a disabled heading button must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a button outside .data-sources-heading must be out of scope');
  });
});
