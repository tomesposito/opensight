import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 105: hover feedback for the data-prep
// document bar's field labels (.prep-document-bar > label in
// DataPrep.tsx — "Dataset name" wrapping its text input and "Saved
// datasets" wrapping its select, both direct children of
// div.prep-document-bar in section.data-prep). The .data-prep label
// rule lays them out as a column flex (text line, gap, field), so the
// label has real visible area, but it had zero hover feedback: every
// label :hover rule in the cascade is scoped elsewhere (author
// toggles, parameter/action editors, O-mode notice, admin dialog,
// connector/sign-in/collection labels, and the slice-103/104
// prep-columns and prep-key-column labels), so the label rested
// transparent and hovering its text or gap changed nothing, while
// only the field inside it tinted via the slice-31 select hover and
// the slice-39 input hover. A CSSOM probe with all five real
// stylesheets in the real ancestor contexts (standalone .data-prep
// and inside .app-shell) confirmed zero matching :hover rules for
// both labels and a transparent rest in both. The labels now take
// #edf6fc, the data-prep surface's established hover tint (the
// slice-31 select hover, the slice-39 button and input/textarea
// hovers, and the slice-103/104 prep label hovers), so no new colour
// is introduced. Background only, so resting geometry is identical
// and there is no animation. The data-prep surface is fixed light,
// so no dark variant.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.prep-document-bar > label:hover\s*\{([^}]*)\}/m);

test('the prep-document-bar label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .prep-document-bar > label :hover rule');
  assert.match(rule[1], /background:\s*#edf6fc/);
});

test('the hover tint matches the data-prep select and prep-columns hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep select hover must remain #edf6fc');
  assert.ok(styleCss.match(/\.prep-columns label:hover\s*\{[^}]*background:\s*#edf6fc/), 'the prep-columns label hover must remain #edf6fc');
});

test('the prep-document-bar label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting prep-document-bar and data-prep label rules are preserved and the fixed-light prep surface gains no dark variant', () => {
  assert.ok(styleCss.match(/\.prep-document-bar\s*\{[^}]*background:\s*#edf2f6/), 'the prep-document-bar resting rule must remain');
  assert.ok(styleCss.match(/\.data-prep label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/), 'the data-prep label resting rule must remain');
  assert.ok(!/data-chrome=dark[^\n]*prep-document-bar/.test(styleCss), 'the fixed-light data-prep surface must not gain a dark variant for this rule');
});

describe('Prep-document-bar label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry in the real ancestor context, and labels that are not direct children of the bar are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<section class="data-prep"><div class="prep-document-bar">`
      + `<label id="docLabel">Dataset name<input type="text"></label>`
      + `<div class="prep-actions"><label id="nestedLabel">Nested<input type="text"></label></div>`
      + `</div><form class="prep-step-editor"><label id="outsideLabel">Step name (optional)<input type="text"></label></form></section>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const found = all.find(r => norm(r) === '.prep-document-bar > label:hover') ?? null;
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
        label: found ? measure(el('docLabel'), found) : null,
        nestedMatches: found ? el('nestedLabel').matches(bare) : null,
        outsideMatches: found ? el('outsideLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.label.rest.background, 'rgba(0, 0, 0, 0)', 'document-bar label rest (transparent)');
    assert.equal(actual.label.hovered.background, 'rgb(237, 246, 252)', 'document-bar label hover');
    assert.notEqual(actual.label.rest.background, actual.label.hovered.background);
    assert.equal(actual.label.rest.color, actual.label.hovered.color, 'document-bar label colour unchanged on hover');
    assert.equal(actual.label.rest.box, actual.label.hovered.box, 'document-bar label geometry');
    assert.equal(actual.nestedMatches, false, 'a label nested inside the bar but not a direct child must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a label outside the document bar must be out of scope');
  });
});
