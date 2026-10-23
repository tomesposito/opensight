import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 115: hover feedback for the
// ParameterEditor's plain field labels (.parameter-editor label —
// "Parameter name" wrapping its text input, "Parameter type"
// wrapping its select, and "Default values" wrapping its textarea
// in ParameterEditor.tsx's create-parameter form, inside
// details.parameter-editor in the author Data panel). The shared
// resting rule lays these labels out as column flexes (text line,
// 4px gap, field), so each label is itself a visible surface, but
// the plain labels had zero hover feedback: slice 99 hovered only
// the editor's checkbox labels via :has(> input[type=checkbox]),
// and every other label :hover rule in the cascade is scoped
// elsewhere (author toggles, the sheet-controls labels of slices
// 112/113 — which share this resting rule and explicitly left the
// parameter-editor labels out as a different surface — the
// connector/sign-in/collection labels, the data-prep label series,
// the change-type label, the admin labels, the embed labels), so
// the labels rested transparent and hovering their text or gap
// changed nothing, while only the field inside each label tinted
// via the author field hovers. A CSSOM probe with all five real
// stylesheets (1,374 rules) in the real ancestor contexts
// (author-workspace > author-layout > builder-panel >
// parameter-editor, light and dark chrome) confirmed zero matching
// :hover rules for all three plain labels and a transparent rest
// in both chromes, while the checkbox labels matched the slice-99
// rules and the name/type/default fields matched the author field
// hovers. The labels now take #edf7f7, the author surface's
// established hover tint (the author button, field and summary
// hovers, the slice-99 checkbox-label hover in this same editor,
// and the slices 112/113 controls-label hovers sharing the resting
// rule), plus the author dark-chrome variant #334c62, so no new
// colour is introduced — and because the inner field's own hover
// is the same tint, hovering the field inside the label reads as
// one surface, not two steps. The slice-99 :has rules keep higher
// specificity with the same tints, so the checkbox labels are
// unchanged. Background only, so resting geometry is identical
// and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.parameter-editor label:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.parameter-editor label:hover\s*\{([^}]*)\}/m);

test('the parameter-editor plain label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the parameter-editor plain label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tints match the author field hovers and the slice-99 checkbox-label hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
  assert.ok(styleCss.match(/^\.parameter-editor label:has\(> input\[type=checkbox\]\):hover\s*\{[^}]*background:\s*#edf7f7/m), 'the slice-99 checkbox label hover must remain #edf7f7');
  assert.ok(darkRule, 'expected the author dark-chrome parameter-editor label :hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.parameter-editor label:has\(> input\[type=checkbox\]\):hover\s*\{[^}]*background:\s*#334c62/m), 'the slice-99 dark checkbox label hover must remain #334c62');
});

test('the parameter-editor label hover rules are paint-only: resting geometry and label presentation cannot shift', () => {
  for (const r of [rule, darkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting parameter-editor label rule and the slice-99 checkbox rules are preserved', () => {
  assert.ok(styleCss.match(/\.parameter-control label, \.control-settings label, \.control-form label, \.parameter-editor label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*4px[^}]*margin-bottom:\s*8px/), 'the shared resting label rule must remain');
  assert.ok(styleCss.match(/^\.parameter-editor label:has\(> input\[type=checkbox\]\):hover/m), 'the slice-99 checkbox label hover must remain');
});

describe('Parameter-editor label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the real ancestor contexts in both chromes, the checkbox labels keep their slice-99 tint, and labels outside the editor are out of scope', async () => {
    const ctx = (id, dark) => `<div class="author-workspace" ${dark ? 'data-chrome="dark"' : ''}><div class="author-layout"><aside class="builder-panel">`
      + `<details class="parameter-editor" open><summary>Parameters</summary><form>`
      + `<label id="${id}Name">Parameter name<input value="x"/></label>`
      + `<label id="${id}Type">Parameter type<select><option>string</option></select></label>`
      + `<label id="${id}Check"><input type="checkbox"/>Multiple values</label>`
      + `<label id="${id}Def">Default values<textarea></textarea></label>`
      + `</form></details></aside></div></div>`;
    await page.setContent(`<style>${allCss}</style>` + ctx('l', false) + ctx('d', true)
      + `<label id="outsideLabel">Outside<input/></label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const light = all.find(r => norm(r) === '.parameter-editor label:hover') ?? null;
      const dark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .parameter-editor label:hover') ?? null;
      const check99 = all.find(r => norm(r) === '.parameter-editor label:has(> input[type=checkbox]):hover') ?? null;
      const check99Dark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .parameter-editor label:has(> input[type=checkbox]):hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        foundLight: !!light, foundDark: !!dark,
        propsLight: light ? [...light.style] : [], propsDark: dark ? [...dark.style] : [],
        lName: light ? measure(el('lName'), light) : null,
        lType: light ? measure(el('lType'), light) : null,
        lDef: light ? measure(el('lDef'), light) : null,
        dName: dark ? measure(el('dName'), dark) : null,
        dType: dark ? measure(el('dType'), dark) : null,
        dDef: dark ? measure(el('dDef'), dark) : null,
        lCheck99: check99 ? measure(el('lCheck'), check99) : null,
        dCheck99: check99Dark ? measure(el('dCheck'), check99Dark) : null,
        checkMatchesPlain: light ? el('lCheck').matches(light.selectorText.replaceAll(':hover', '')) : null,
        outsideMatches: light ? el('outsideLabel').matches(light.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.ok(actual.foundLight, 'expected the light hover rule in the CSSOM');
    assert.ok(actual.foundDark, 'expected the dark hover rule in the CSSOM');
    for (const props of [actual.propsLight, actual.propsDark]) {
      assert.ok(props.length && props.every(p => p.startsWith('background')), 'hover rules must set background longhands only');
    }
    for (const key of ['lName', 'lType', 'lDef']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} label rest (transparent)`);
      assert.equal(actual[key].hovered.background, 'rgb(237, 247, 247)', `${key} label hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} label colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} label geometry`);
    }
    for (const key of ['dName', 'dType', 'dDef']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} label rest (transparent)`);
      assert.equal(actual[key].hovered.background, 'rgb(51, 76, 98)', `${key} label hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} label colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} label geometry`);
    }
    assert.equal(actual.lCheck99.hovered.background, 'rgb(237, 247, 247)', 'the light checkbox label keeps its slice-99 tint');
    assert.equal(actual.dCheck99.hovered.background, 'rgb(51, 76, 98)', 'the dark checkbox label keeps its slice-99 tint');
    assert.equal(actual.checkMatchesPlain, true, 'the plain rule also covers the checkbox labels, at the same tint and below the slice-99 specificity');
    assert.equal(actual.outsideMatches, false, 'a label outside .parameter-editor must be out of scope');
  });
});
