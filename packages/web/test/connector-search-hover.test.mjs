import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 90: hover feedback for the connector
// gallery's search input (.connector-search input[type=search] in
// DataSources.tsx — "Find a data source", in the .connector-picker of
// the standalone gallery, section.data-sources inside .app-shell >
// main). Every input:hover rule in the cascade is scoped elsewhere —
// author-workspace/author-layout, data-page/data-dialog (the gallery
// page is not .data-page and the standalone gallery is not a
// .data-dialog), admin-settings, the analysis-file/calculation
// dialogs, embed, sign-in, the Q side panel, the command
// palette/global search, collection-card — so this input matched no
// :hover rule. A CSSOM probe with all five real stylesheets (1,342
// rules) in the real ancestor context confirmed zero matching :hover
// rules and a white rest, while the gallery's cards
// (.connector-card:hover) and its submit (slice 66) do step. It now
// takes the app surfaces' established field hover tint (#eaf3f7 — the
// data search inputs, slices 27/48, and the collection fields, slices
// 23/64). Background only, so resting colour and geometry are
// unchanged. The gallery is a fixed-light app-shell surface, so no
// dark variant is added.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const dataCss = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const rule = css.match(/^\.connector-search input\[type=search\]:hover:not\(:disabled\)\s*\{([^}]*)\}/m);

test('the connector-search hover rule exists and uses the established field tint', () => {
  assert.ok(rule, 'expected the .connector-search input[type=search]:hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the data search-input hovers, so no new colour is introduced', () => {
  assert.ok(dataCss.match(/\.data-page input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page search hover must remain #eaf3f7');
  assert.ok(dataCss.match(/\.data-dialog input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-dialog search hover must remain #eaf3f7');
});

test('the search hover rule is paint-only: resting geometry and field presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting connector-search rules are preserved', () => {
  assert.ok(css.match(/\.connector-search\s*\{[^}]*display:\s*grid/), 'the connector-search resting rule must remain');
  assert.ok(css.match(/\.connector-search input\s*\{[^}]*background:\s*white/), 'the search input resting background must remain white');
  assert.ok(css.match(/\.connector-card:hover\s*\{[^}]*background:\s*#f8fbff/), 'the connector-card hover must remain');
});

describe('Connector-search hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry, and search inputs outside .connector-search are out of scope', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<div class="app-shell"><main><section class="data-sources"><div class="connector-layout"><div class="connector-picker">`
      + `<label class="connector-search">Find a data source<input id="target" type="search" placeholder="Search data sources"></label>`
      + `</div></div></section></main></div>`
      + `<input id="outside" type="search">`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '').replaceAll('"', '') === '.connector-search input[type=search]:hover:not(:disabled)') ?? null;
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
    assert.equal(actual.target.rest.background, 'rgb(255, 255, 255)', 'connector-search rest');
    assert.equal(actual.target.hovered.background, 'rgb(234, 243, 247)', 'connector-search hover');
    assert.notEqual(actual.target.rest.background, actual.target.hovered.background);
    assert.equal(actual.target.rest.color, actual.target.hovered.color, 'connector-search colour unchanged on hover');
    assert.equal(actual.target.rest.box, actual.target.hovered.box, 'connector-search geometry');
    assert.equal(actual.outsideMatches, false, 'a search input outside .connector-search must be out of scope');
  });
});
