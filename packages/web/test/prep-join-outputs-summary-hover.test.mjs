import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 69: hover feedback for the data-prep join
// editor's "Right output columns" disclosure summary. Every other
// data-prep control hovers to the surface tint (#edf6fc): buttons,
// selects, inputs and textareas via the .data-prep rules, and the
// prep-execution disclosure summary via slice 41. The join outputs
// summary (.prep-join-outputs summary in PrepJoinEditor.tsx) is none
// of those elements, so no hover rule reached it — its only rule gave
// the pointer cursor and a bottom margin — and hovering it changed
// nothing while every other control in the join editor tinted. It
// only renders while a join step is being configured, so route audits
// never reach it. It now takes the data-prep surface's own hover tint
// (#edf6fc). Background only, so resting geometry is identical and
// there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const rule = styleCss.match(/\.prep-join-outputs\s+summary:hover\s*\{([^}]*)\}/);

test('the prep-join-outputs summary has a hover state with the data-prep tint', () => {
  assert.ok(rule, 'expected the .prep-join-outputs summary hover rule');
  assert.match(rule[1], /background:\s*#edf6fc/);
});

test('the summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting prep-join-outputs rules are preserved', () => {
  assert.ok(styleCss.match(/\.prep-join-outputs summary\s*\{[^}]*cursor:\s*pointer; margin-bottom:\s*8px/), 'the summary resting rule must remain');
  assert.ok(styleCss.match(/\.prep-join-outputs label\s*\{[^}]*margin-bottom:\s*8px/), 'the outputs label resting rule must remain');
});

test('the neighbouring data-prep hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.data-prep button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep button hover must remain');
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep select hover must remain');
  assert.ok(styleCss.match(/\.data-prep input:hover:not\(:disabled\), \.data-prep textarea:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep field hover must remain');
  assert.ok(styleCss.match(/\.prep-execution summary:hover\s*\{[^}]*background:\s*#edf6fc/), 'slice 41 prep-execution summary hover must remain');
});

describe('prep-join-outputs summary hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${styleCss}</style>`
      + `<section class="data-prep"><div class="prep-join-settings"><details class="prep-join-outputs"><summary id="s">Right output columns</summary></details></div></section>`
      + `<details><summary id="outside">Outside summary</summary></details>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.prep-join-outputs summary:hover') ?? null;
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
        s: found ? measure(document.querySelector('#s'), found) : null,
        outsideMatches: matches(document.querySelector('#outside'), found),
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.equal(actual.s.rest.background, 'rgba(0, 0, 0, 0)', 'summary rest');
    assert.equal(actual.s.hovered.background, 'rgb(237, 246, 252)', 'summary hover');
    assert.equal(actual.s.rest.box, actual.s.hovered.box, 'summary geometry');
    assert.equal(actual.outsideMatches, false, 'a summary outside the prep-join-outputs disclosure must be out of scope');
  });
});
