import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 68: hover feedback for the "Build for me"
// disclosure summary inside the Calculated field dialog. Slice 46
// gave the dialog (.calculation-dialog — a sibling outside
// .author-workspace, so the author hover rules never reach it) hover
// states for its buttons, primary button, inputs, selects and
// textareas, but the BuildForMe <details> summary (.o-build-for-me
// summary) is none of those: slice 42's summary hover rules are all
// scoped to .author-workspace, and the global summary rules give only
// cursor and an :active press, so hovering "Build for me" changed
// nothing while every other control in the same dialog tinted. It now
// takes the dialog's own hover tint (#edf7f7, slice 46's button/field
// tint). The dialog's resting colors are fixed light (no dark-chrome
// variant), so no dark variant is added. Background only, so resting
// geometry is identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const rule = styleCss.match(/\.calculation-dialog\s+\.o-build-for-me\s+summary:hover\s*\{([^}]*)\}/);

test('the build-for-me summary has a hover state with the calculation dialog tint', () => {
  assert.ok(rule, 'expected the .calculation-dialog .o-build-for-me summary hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting build-for-me rules are preserved', () => {
  assert.ok(styleCss.match(/\.o-build-for-me\s*\{[^}]*border:\s*1px solid #a9c5d2/), 'the build-for-me resting frame must remain');
  assert.ok(styleCss.match(/\.o-build-for-me summary\s*\{[^}]*font-weight:\s*600; cursor:\s*pointer/), 'the summary resting rule must remain');
});

test('the neighbouring calculation-dialog hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.calculation-dialog button:hover:not\(:disabled\)\s*\{[^}]*border-color:\s*#157f88; background:\s*#edf7f7/), 'slice 46 button hover must remain');
  assert.ok(styleCss.match(/\.calculation-dialog \.primary-button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#126e76/), 'slice 46 primary hover must remain');
  assert.ok(styleCss.match(/\.calculation-dialog input:hover:not\(:disabled\), \.calculation-dialog select:hover:not\(:disabled\), \.calculation-dialog textarea:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'slice 46 field hover must remain');
});

test('the author-workspace summary hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.author-workspace \.builder-panel > summary:hover/), 'slice 42 summary hover must remain');
});

describe('build-for-me summary hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${styleCss}</style>`
      + `<dialog class="calculation-dialog" open><form><details class="o-build-for-me"><summary id="s">Build for me</summary><p>Local deterministic templates</p></details></form></dialog>`
      + `<div class="author-workspace"><details class="o-build-for-me"><summary id="outside">Build for me</summary></details></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '').includes('o-build-for-me') && (r.selectorText || '').includes('summary:hover')) ?? null;
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
    assert.equal(actual.s.hovered.background, 'rgb(237, 247, 247)', 'summary hover');
    assert.equal(actual.s.rest.box, actual.s.hovered.box, 'summary geometry');
    assert.equal(actual.outsideMatches, false, 'a build-for-me summary outside the calculation dialog must be out of scope');
  });
});
