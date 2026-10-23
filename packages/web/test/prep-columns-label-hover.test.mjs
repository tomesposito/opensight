import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 103: hover feedback for the data-prep
// column-picker rows (.prep-columns label in PrepColumns.tsx — the
// full-row label wrapping the drag handle, checkbox, column name and
// type inside fieldset.prep-columns in form.prep-step-editor in
// section.data-prep, used by the select/group-by/pivot/unpivot step
// editors). The row is the interactive surface — clicking anywhere on
// it toggles the column, selected rows are focusable and draggable —
// but it had zero hover feedback: every label :hover rule in the
// cascade is scoped elsewhere (author toggles, parameter/action
// editors, O-mode notice, admin dialog, connector/sign-in/collection
// labels), so the row rested transparent and hovering its name, type
// or handle changed nothing, while only the small checkbox box tinted
// via the slice-39 .data-prep input hover. A CSSOM probe with all
// five real stylesheets in the real ancestor context confirmed zero
// matching :hover rules for the row label and a transparent rest.
// The rows now take #edf6fc, the data-prep surface's established
// hover tint (the slice-31 select hover and the slice-39 button and
// input/textarea hovers), so no new colour is introduced. Background
// only, so resting geometry is identical and there is no animation.
// The data-prep surface is fixed light, so no dark variant.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.prep-columns label:hover\s*\{([^}]*)\}/m);

test('the prep-columns label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .prep-columns label :hover rule');
  assert.match(rule[1], /background:\s*#edf6fc/);
});

test('the hover tint matches the data-prep button and input hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.data-prep button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep button hover must remain #edf6fc');
  assert.ok(styleCss.match(/\.data-prep input:hover:not\(:disabled\), \.data-prep textarea:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep input hover must remain #edf6fc');
});

test('the prep-columns label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting prep-columns rules are preserved and the fixed-light prep surface gains no dark variant', () => {
  assert.ok(styleCss.match(/\.prep-columns\s*\{[^}]*max-height:\s*220px/), 'the prep-columns container resting rule must remain');
  assert.ok(styleCss.match(/\.prep-columns label\s*\{[^}]*flex-direction:\s*row[^}]*align-items:\s*center/), 'the prep-columns label resting rule must remain');
  assert.ok(!/data-chrome=dark[^\n]*prep-columns/.test(styleCss), 'the fixed-light data-prep surface must not gain a dark variant for this rule');
});

describe('Prep-columns label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the row visual state with identical geometry in the real ancestor context, and labels outside the column picker are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<section class="data-prep"><form class="prep-step-editor"><fieldset class="prep-columns"><legend>Keep columns</legend>`
      + `<label id="rowLabel"><span class="prep-drag-handle" aria-hidden="true">⠿</span><input id="rowCheck" type="checkbox">region<small>string</small></label>`
      + `</fieldset></form>`
      + `<label id="outsideLabel"><input type="checkbox">Other label</label></section>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const found = all.find(r => norm(r) === '.prep-columns label:hover') ?? null;
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
        row: found ? measure(el('rowLabel'), found) : null,
        outsideMatches: found ? el('outsideLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.row.rest.background, 'rgba(0, 0, 0, 0)', 'row label rest (transparent)');
    assert.equal(actual.row.hovered.background, 'rgb(237, 246, 252)', 'row label hover');
    assert.notEqual(actual.row.rest.background, actual.row.hovered.background);
    assert.equal(actual.row.rest.color, actual.row.hovered.color, 'row label colour unchanged on hover');
    assert.equal(actual.row.rest.box, actual.row.hovered.box, 'row label geometry');
    assert.equal(actual.outsideMatches, false, 'a label outside the column picker must be out of scope');
  });
});
