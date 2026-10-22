import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 84: hover feedback for the Properties
// panel's "Unsupported features (retained)" disclosure summary (a
// plain <details><summary> inside .dataset-binding in Author.tsx's
// Properties — the Dataset binding block for an imported visual).
// Every summary:hover rule in the cascade is scoped elsewhere — the
// builder-panel/field-group/property-section/parameter-editor/
// local-drafts hovers take direct-child summaries only, and the
// bundle-import/imported-panel/control-settings/card-footer/
// first-run/prep hovers take summaries inside their own containers —
// so this summary, inside a plain details in a .dataset-binding,
// matched none of them; its only rules are the global cursor and the
// global :active press, while the Remap button in the same block does
// tint via the author generic button hover. A CSSOM probe with the
// real stylesheet in the real ancestor context confirmed zero
// matching :hover rules and a transparent rest. It now takes the
// author surface's established hover tint (#edf7f7), so no new colour
// is introduced; the dark-chrome variant takes #334c62, the dark
// summary hover of the neighbouring panels. Background only, so
// resting geometry is identical and there is no animation.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const rule = css.match(/\.dataset-binding summary:hover\s*\{([^}]*)\}/);
const darkRule = css.match(/\.author-workspace\[data-chrome=dark\] \.dataset-binding summary:hover\s*\{([^}]*)\}/);

test('the dataset-binding summary hover rule exists and uses the author surface tint', () => {
  assert.ok(rule, 'expected the .dataset-binding summary:hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint is the established author hover tint, distinct from the transparent rest', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author generic button hover must remain #edf7f7');
  assert.ok(css.match(/\.author-workspace \.builder-panel > summary:hover[^{]*\{[^}]*background:\s*#edf7f7/), 'the builder-panel summary hover must remain #edf7f7');
  assert.notEqual('#edf7f7', 'transparent', 'the hover tint must differ from the resting state');
});

test('the dark-chrome variant uses the established dark summary hover tint', () => {
  assert.ok(darkRule, 'expected the dark-chrome dataset-binding summary hover rule');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(css.match(/\.author-workspace\[data-chrome=dark\] \.builder-panel > summary:hover[^{]*\{[^}]*background:\s*#334c62/), 'the dark builder-panel summary hover must remain #334c62');
});

test('the summary hover rules are paint-only: resting geometry cannot shift', () => {
  assert.ok(rule && darkRule, 'expected both hover rules');
  for (const r of [rule, darkRule]) assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
});

test('the resting dataset-binding rules are preserved', () => {
  assert.ok(css.match(/\.import-report li, \.bundle-placeholder, \.dataset-binding\s*\{[^}]*overflow-wrap:\s*anywhere/), 'the dataset-binding overflow-wrap rule must remain');
  assert.ok(css.match(/\.control-settings\s*\{[^}]*font-size:\s*12px; margin-top:\s*8px/), 'the control-settings layout rule must remain');
});

test('the neighbouring summary hover rules are untouched', () => {
  assert.ok(css.match(/\.control-settings summary:hover\s*\{[^}]*background:\s*#edf7f7/), 'the slice-83 control-settings summary hover must remain #edf7f7');
  assert.ok(css.match(/\.imported-panel summary:hover\s*\{[^}]*background:\s*#edf7f7/), 'the slice-82 imported-panel summary hover must remain #edf7f7');
  assert.ok(css.match(/\.prep-execution summary:hover\s*\{[^}]*background:\s*#edf6fc/), 'the prep-execution summary hover must remain #edf6fc');
});

describe('Dataset-binding summary hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<div class="author-workspace" data-chrome="light"><details class="builder-panel properties-panel" open><summary id="panel">Properties</summary><div class="panel-content">`
      + `<div role="tabpanel"><details class="property-section" open><summary id="prop">Display settings</summary></details>`
      + `<div class="dataset-binding"><h3>Dataset binding</h3><details open><summary id="target">Unsupported features (retained)</summary></details></div>`
      + `</div></div></details></div>`
      + `<details><summary id="outside">Outside summary</summary></details>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.dataset-binding summary:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const matches = (el, rule) => rule ? el.matches(rule.selectorText.replaceAll(':hover', '')) : null;
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        target: found ? measure(document.querySelector('#target'), found) : null,
        propMatches: matches(document.querySelector('#prop'), found),
        panelMatches: matches(document.querySelector('#panel'), found),
        outsideMatches: matches(document.querySelector('#outside'), found),
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.target.rest.background, 'rgba(0, 0, 0, 0)', 'summary rest');
    assert.equal(actual.target.hovered.background, 'rgb(237, 247, 247)', 'summary hover');
    assert.notEqual(actual.target.rest.background, actual.target.hovered.background);
    assert.equal(actual.target.rest.box, actual.target.hovered.box, 'summary geometry');
    assert.equal(actual.propMatches, false, 'the property-section summary must be out of scope');
    assert.equal(actual.panelMatches, false, 'the builder-panel summary must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a summary outside .dataset-binding must be out of scope');
  });
});
