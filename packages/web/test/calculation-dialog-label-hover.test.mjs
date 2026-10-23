import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 117: hover feedback for the Calculated
// field dialog's field labels (.calculation-dialog label — "Name",
// "Use as", "Expression" and "Function reference" in
// CalculationDialog in Author.tsx). The shared resting rule
// (.author-layout label, .analysis-title, .rename-sheet label,
// .calculation-dialog label) lays these labels out as column
// flexes (text line, 4px gap, field), so each label is itself a
// visible surface, but the labels had zero hover feedback: slice
// 46 hovered the dialog's buttons and fields and slice 68 its
// "Build for me" summary, while every label :hover rule in the
// cascade is scoped elsewhere (property-section, parameter-editor,
// sheet-controls, action lists, O-mode notice,
// connector/sign-in/collection labels, the data-prep label series,
// the change-type label, the admin labels, the embed labels), so
// the labels rested transparent and hovering their text or gap
// changed nothing, while only the field inside each label tinted
// via the slice-46 field hovers. The dialog renders outside
// .author-workspace (a sibling of it in Author.tsx), so the author
// label hovers never reach it either. The labels now take
// #edf7f7, the dialog's own established hover tint (slice 46's
// button, field and summary hovers in this same dialog), so no
// new colour is introduced — and because the inner field's own
// hover is the same tint, hovering the field inside the label
// reads as one surface, not two steps. The dialog's resting
// colors are fixed light (it has no dark-chrome variant), so no
// dark variant is added. Background only, so resting geometry is
// identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.calculation-dialog label:hover\s*\{([^}]*)\}/m);

test('the calculation-dialog label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the calculation-dialog label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint matches the slice-46 dialog field hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.calculation-dialog input:hover:not\(:disabled\), \.calculation-dialog select:hover:not\(:disabled\), \.calculation-dialog textarea:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-46 dialog field hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.calculation-dialog \.o-build-for-me summary:hover\s*\{[^}]*background:\s*#edf7f7/), 'the slice-68 dialog summary hover must remain #edf7f7');
});

test('the calculation-dialog label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting shared label rule and the slice-46/68 dialog hover rules are preserved', () => {
  assert.ok(styleCss.match(/\.author-layout label, \.analysis-title, \.rename-sheet label, \.calculation-dialog label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*4px[^}]*margin-bottom:\s*8px/), 'the shared resting label rule must remain');
  assert.ok(styleCss.match(/\.calculation-dialog button:hover:not\(:disabled\)/), 'the slice-46 dialog button hover must remain');
  assert.ok(styleCss.match(/\.calculation-dialog \{[^}]*padding:\s*24px/), 'the dialog resting rule must remain');
});

describe('Calculation-dialog label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry in the real ancestor context, and labels outside the dialog are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<dialog class="calculation-dialog" open><form><h2>Calculated field</h2>`
      + `<label id="nameLabel">Name<input value="x"/></label>`
      + `<label id="roleLabel">Use as<select><option>Measure (number)</option></select></label>`
      + `<label id="exprLabel">Expression<textarea rows="5"></textarea></label>`
      + `<label id="fnLabel">Function reference<select><option>concat</option></select></label>`
      + `</form></dialog>`
      + `<label id="outsideLabel">Outside<input/></label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const found = all.find(r => norm(r) === '.calculation-dialog label:hover') ?? null;
      const field = all.find(r => norm(r).includes('.calculation-dialog textarea:hover')) ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        name: found ? measure(el('nameLabel'), found) : null,
        role: found ? measure(el('roleLabel'), found) : null,
        expr: found ? measure(el('exprLabel'), found) : null,
        fn: found ? measure(el('fnLabel'), found) : null,
        fieldRuleFound: !!field,
        outsideMatches: found ? el('outsideLabel').matches(found.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    for (const key of ['name', 'role', 'expr', 'fn']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} label rest (transparent)`);
      assert.equal(actual[key].hovered.background, 'rgb(237, 247, 247)', `${key} label hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} label colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} label geometry`);
    }
    assert.equal(actual.fieldRuleFound, true, 'the slice-46 field hover rule must still be present');
    assert.equal(actual.outsideMatches, false, 'a label outside .calculation-dialog must be out of scope');
  });
});
