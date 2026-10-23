import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 108: hover feedback for the data-prep
// staging source-picker label (.prep-staging > label in
// DataPrep.tsx — "Stage a source" wrapping its PrepSourcePicker
// select in the staging view, the direct-child label of
// div.prep-staging in section.prep-configure in section.data-prep).
// The .data-prep label rule lays it out as a column flex (text
// line, gap, field), so the label has real visible area, but it
// had zero hover feedback: every label :hover rule in the cascade
// is scoped elsewhere (author toggles, parameter/action editors,
// O-mode notice, admin dialog, connector/sign-in/collection
// labels, and the slice-103/104/105/106/107 prep-columns,
// prep-key-column, prep-document-bar, prep-step-editor and
// prep-input-config labels), so the label rested transparent and
// hovering its text or gap changed nothing, while only the select
// inside it tinted via the slice-31 select hover. This was the
// backup lead left by slice 107. The label now takes #edf6fc, the
// data-prep surface's established hover tint (the slice-31 select
// hover, the slice-39 button and input/textarea hovers, and the
// slice-103/104/105/106/107 prep label hovers), so no new colour
// is introduced. The child-combinator scope keeps labels nested
// deeper in the staging view out — the input-config picker's
// label already takes the identical tint via slice 107 and the
// step-editor's labels via slice 106. Background only, so resting
// geometry is identical and there is no animation. The data-prep
// surface is fixed light, so no dark variant.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.prep-staging > label:hover\s*\{([^}]*)\}/m);

test('the prep-staging label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .prep-staging > label :hover rule');
  assert.match(rule[1], /background:\s*#edf6fc/);
});

test('the hover tint matches the data-prep select and prep-columns hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep select hover must remain #edf6fc');
  assert.ok(styleCss.match(/\.prep-columns label:hover\s*\{[^}]*background:\s*#edf6fc/), 'the prep-columns label hover must remain #edf6fc');
});

test('the prep-staging label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting prep-staging and data-prep label rules are preserved and the fixed-light prep surface gains no dark variant', () => {
  assert.ok(styleCss.match(/\.prep-step-editor > label, \.prep-input-config > label, \.prep-staging > label\s*\{[^}]*max-width:\s*360px/), 'the prep-staging label resting rule must remain');
  assert.ok(styleCss.match(/\.data-prep label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/), 'the data-prep label resting rule must remain');
  assert.ok(!/data-chrome=dark[^\n]*prep-staging/.test(styleCss), 'the fixed-light data-prep surface must not gain a dark variant for this rule');
});

describe('Prep-staging label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry in the real ancestor context, and labels outside the staging view are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<section class="data-prep"><div class="prep-workspace"><div class="prep-main"><section class="prep-configure">`
      + `<div class="prep-staging"><h3>Add data</h3>`
      + `<label id="stagingLabel">Stage a source<select><option>Sales</option></select></label>`
      + `</div>`
      + `<div class="prep-input-config"><label id="pickerLabel">Connected source<select><option>Sales</option></select></label></div>`
      + `<form class="prep-step-editor"><label id="stepLabel">Step name (optional)<input type="text"></label></form>`
      + `</section></div></div></section>`
      + `<div class="prep-document-bar"><label id="docLabel">Dataset name<input type="text"></label></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const found = all.find(r => norm(r) === '.prep-staging > label:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const bare = found ? found.selectorText.replaceAll(':hover', '') : '';
      const el = id => document.querySelector(`#${id}`);
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        staging: found ? measure(el('stagingLabel'), found) : null,
        pickerMatches: found ? el('pickerLabel').matches(bare) : null,
        stepMatches: found ? el('stepLabel').matches(bare) : null,
        docMatches: found ? el('docLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.staging.rest.background, 'rgba(0, 0, 0, 0)', 'staging label rest (transparent)');
    assert.equal(actual.staging.hovered.background, 'rgb(237, 246, 252)', 'staging label hover');
    assert.notEqual(actual.staging.rest.background, actual.staging.hovered.background);
    assert.equal(actual.staging.rest.color, actual.staging.hovered.color, 'staging label colour unchanged on hover');
    assert.equal(actual.staging.rest.box, actual.staging.hovered.box, 'staging label geometry');
    assert.equal(actual.pickerMatches, false, 'the input-config source-picker label outside the staging view must be out of scope');
    assert.equal(actual.stepMatches, false, 'a step-editor label outside the staging view must be out of scope');
    assert.equal(actual.docMatches, false, 'a document-bar label outside the staging view must be out of scope');
  });
});
