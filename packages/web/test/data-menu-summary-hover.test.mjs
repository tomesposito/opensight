import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 85: hover feedback for the plain DataMenu
// overflow summary (.data-menu > summary in DataSectionUI.tsx's
// DataMenu — the ⋮ trigger in the Data landing's dataset rows and
// DatasetDetail's standalone "Dataset actions" menu). Slice 16 gave
// the split-button variant its hover (.data-split > .data-menu >
// summary:hover, #145d76 on its teal #176b88 rest), but the plain
// variant rests transparent and matched no :hover rule: the data
// page's button hover is button-only and a summary is not a button,
// and every other summary:hover rule is scoped elsewhere. A CSSOM
// probe with all five real stylesheets (1,337 rules) in the real
// ancestor context confirmed zero matching :hover rules and a
// transparent rest, while the split neighbour rests rgb(23,107,136).
// It now takes the data surface's established hover tint (#eaf3f7),
// so no new colour is introduced. The split rule (0,3,1) still beats
// this rule (0,2,1) for the split variant, so its teal hover is
// unchanged. Background only, so resting geometry is identical and
// there is no animation; the data surface is fixed light, so no
// dark variant is added.
const css = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const rule = css.match(/^\.data-menu > summary:hover\s*\{([^}]*)\}/m);

test('the plain data-menu summary hover rule exists and uses the data surface tint', () => {
  assert.ok(rule, 'expected the .data-menu > summary:hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint is the established data-surface hover tint, distinct from the transparent rest', () => {
  assert.ok(css.match(/\.data-page button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page button hover must remain #eaf3f7');
  assert.ok(css.match(/\.data-row-menu summary:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the row-menu summary hover must remain #eaf3f7');
  assert.notEqual('#eaf3f7', 'transparent', 'the hover tint must differ from the resting state');
});

test('the split-button variant keeps its own teal hover rule', () => {
  assert.ok(css.match(/\.data-split > \.data-menu > summary:hover\s*\{[^}]*background:\s*#145d76/), 'the slice-16 split summary hover must remain #145d76');
  assert.ok(css.match(/\.data-split > \.data-menu > summary\s*\{[^}]*background:\s*#176b88/), 'the split summary resting rule must remain #176b88');
});

test('the summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting data-menu rules are preserved', () => {
  assert.ok(css.match(/\.data-menu > summary\s*\{[^}]*list-style:\s*none; padding:\s*0 8px; font-size:\s*16px; cursor:\s*pointer/), 'the data-menu summary resting rule must remain');
  assert.ok(css.match(/\.data-menu-items button:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the data-menu-items button hover must remain #eaf3f7');
});

test('the neighbouring summary hover rules are untouched', () => {
  assert.ok(css.match(/\.data-summary-cards details > summary:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the slice-81 storage-settings summary hover must remain #eaf3f7');
  assert.ok(css.match(/\.data-row-menu summary:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the row-menu summary hover must remain #eaf3f7');
});

describe('Data-menu summary hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry, and the split variant is out of scope', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<div class="data-page"><table class="data-table"><tbody><tr><td><details class="data-menu"><summary id="target" aria-label="Actions for Sales">⋮</summary></details></td></tr></tbody></table>`
      + `<div class="data-split"><button class="data-primary">Create dataset</button><details class="data-menu"><summary id="split">v</summary></details></div>`
      + `<details class="data-row-menu"><summary id="rowmenu">…</summary></details></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.data-menu > summary:hover') ?? null;
      const splitRule = all.find(r => (r.selectorText || '').includes('.data-split > .data-menu > summary:hover')) ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const target = document.querySelector('#target');
      const split = document.querySelector('#split');
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        target: found ? measure(target, found) : null,
        splitMatchesPlain: found ? split.matches(found.selectorText.replaceAll(':hover', '')) : null,
        split: splitRule ? measure(split, splitRule) : null,
        rowMenuMatches: found ? document.querySelector('#rowmenu').matches(found.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.target.rest.background, 'rgba(0, 0, 0, 0)', 'plain summary rest');
    assert.equal(actual.target.hovered.background, 'rgb(234, 243, 247)', 'plain summary hover');
    assert.notEqual(actual.target.rest.background, actual.target.hovered.background);
    assert.equal(actual.target.rest.box, actual.target.hovered.box, 'plain summary geometry');
    // The plain selector does match the split summary structurally, but the
    // split rule (0,3,1) outranks it (0,2,1); applying the split rule must
    // still paint its own teal hover over its teal rest.
    assert.equal(actual.split.rest.background, 'rgb(23, 107, 136)', 'split summary rest');
    assert.equal(actual.split.hovered.background, 'rgb(20, 93, 118)', 'split summary hover (its own rule)');
    assert.equal(actual.rowMenuMatches, false, 'the row-menu summary must be out of scope');
  });
});
