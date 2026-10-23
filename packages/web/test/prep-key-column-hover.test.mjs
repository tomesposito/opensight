import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 104: hover feedback for the data-prep join
// editor's key-column labels (.prep-key-column in PrepJoinEditor.tsx —
// the label wrapping the drag handle and the column select inside
// fieldset.prep-join-keys in form.prep-step-editor in section.data-prep).
// The label is itself an interactive surface — it is the drop target
// for dragged table columns and wraps the key-pair drag handle — but
// it had zero hover feedback: every label :hover rule in the cascade
// is scoped elsewhere (author toggles, parameter/action editors,
// O-mode notice, admin dialog, connector/sign-in/collection labels,
// and the slice-103 prep-columns rows), so the label rested
// transparent and hovering its handle or gaps changed nothing, while
// only the select inside it tinted via the slice-31 select hover. A
// CSSOM probe with all five real stylesheets in the real ancestor
// context confirmed zero matching :hover rules for the label and a
// transparent rest. The label now takes #edf6fc, the data-prep
// surface's established hover tint (the slice-31 select hover, the
// slice-39 button and input/textarea hovers, and the slice-103
// prep-columns row hover), so no new colour is introduced. Background
// only, so resting geometry is identical and there is no animation.
// The data-prep surface is fixed light, so no dark variant.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.prep-key-column:hover\s*\{([^}]*)\}/m);

test('the prep-key-column hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .prep-key-column :hover rule');
  assert.match(rule[1], /background:\s*#edf6fc/);
});

test('the hover tint matches the data-prep select and prep-columns hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep select hover must remain #edf6fc');
  assert.ok(styleCss.match(/\.prep-columns label:hover\s*\{[^}]*background:\s*#edf6fc/), 'the prep-columns label hover must remain #edf6fc');
});

test('the prep-key-column hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting prep-key-column rules are preserved and the fixed-light prep surface gains no dark variant', () => {
  assert.ok(styleCss.match(/\.prep-key-column\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*row/), 'the prep-key-column resting rule must remain');
  assert.ok(styleCss.match(/\.data-prep \.prep-key-column select\s*\{[^}]*border-radius:\s*16px/), 'the prep-key-column select resting rule must remain');
  assert.ok(!/data-chrome=dark[^\n]*prep-key-column/.test(styleCss), 'the fixed-light data-prep surface must not gain a dark variant for this rule');
});

describe('Prep-key-column hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry in the real ancestor context, and labels outside the join keys are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<section class="data-prep"><form class="prep-step-editor"><div class="prep-join-editor"><div class="prep-join-settings"><fieldset class="prep-join-keys"><legend>Join keys</legend><div class="prep-join-key">`
      + `<label class="prep-key-column" id="keyLabel"><span class="prep-drag-handle" aria-hidden="true">⠿</span><select id="keySelect"><option>region</option></select></label>`
      + `</div></fieldset></div></div></form>`
      + `<label id="outsideLabel"><input type="checkbox">Other label</label></section>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const found = all.find(r => norm(r) === '.prep-key-column:hover') ?? null;
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
        label: found ? measure(el('keyLabel'), found) : null,
        outsideMatches: found ? el('outsideLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.label.rest.background, 'rgba(0, 0, 0, 0)', 'key label rest (transparent)');
    assert.equal(actual.label.hovered.background, 'rgb(237, 246, 252)', 'key label hover');
    assert.notEqual(actual.label.rest.background, actual.label.hovered.background);
    assert.equal(actual.label.rest.color, actual.label.hovered.color, 'key label colour unchanged on hover');
    assert.equal(actual.label.rest.box, actual.label.hovered.box, 'key label geometry');
    assert.equal(actual.outsideMatches, false, 'a label outside the join keys must be out of scope');
  });
});
