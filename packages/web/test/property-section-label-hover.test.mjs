import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 116: hover feedback for the Properties
// panel sections' plain field labels (.property-section label —
// "Edit title", "Title font size" and "Alt text" in
// PropertiesSections.tsx, "Hierarchy name" and "Level dimension"
// in HierarchyEditor.tsx, "Metric placement" and "Column width
// (px)" in PivotOptionsEditor.tsx, the header/cell colour,
// font-size, display-name and rule labels in
// FormattingEditor.tsx, "Palette override", "Analysis palette",
// "Analysis font" and the .color-inputs colour labels in
// ThemeEditor.tsx, and the sheet-object Placement labels in
// SheetObjectCard.tsx, all inside details.property-section in the
// author Properties panel). The shared resting rule
// (.author-layout label) lays these labels out as column flexes
// (text line, 4px gap, field), so each label is itself a visible
// surface, but the plain labels had zero hover feedback: slice 97
// hovered only the sections' checkbox labels via label.toggle,
// and every other label :hover rule in the cascade is scoped
// elsewhere (parameter-editor, sheet-controls, action lists,
// O-mode notice, connector/sign-in/collection labels, the
// data-prep label series, the change-type label, the admin
// labels, the embed labels), so the labels rested transparent and
// hovering their text or gap changed nothing, while only the
// field inside each label tinted via the author field hovers. A
// CSSOM probe with all five real stylesheets (1,378 rules) in the
// real ancestor contexts (author-workspace > author-layout >
// properties-panel > details.property-section, light and dark
// chrome) confirmed zero matching :hover rules for the plain
// labels and a transparent rest in both chromes, while the
// toggle labels matched the slice-97 rules and the name/font
// fields matched the author field hovers. The labels now take
// #edf7f7, the author surface's established hover tint (the
// author button, field and summary hovers, the slice-97 toggle
// hover in these same sections, and the slices 112-115 label
// hovers), plus the author dark-chrome variant #334c62, so no new
// colour is introduced — and because the inner field's own hover
// is the same tint, hovering the field inside the label reads as
// one surface, not two steps. The slice-97 toggle rules carry the
// same tints, so the toggle labels are unchanged whichever rule
// wins. Background only, so resting geometry is identical and
// there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.property-section label:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.property-section label:hover\s*\{([^}]*)\}/m);

test('the property-section plain label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the property-section plain label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tints match the author field hovers and the slice-97 toggle-label hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
  assert.ok(styleCss.match(/^label\.toggle:hover\s*\{[^}]*background:\s*#edf7f7/m), 'the slice-97 toggle label hover must remain #edf7f7');
  assert.ok(darkRule, 'expected the author dark-chrome property-section label :hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/^\.author-workspace\[data-chrome=dark\] label\.toggle:hover\s*\{[^}]*background:\s*#334c62/m), 'the slice-97 dark toggle label hover must remain #334c62');
});

test('the property-section label hover rules are paint-only: resting geometry and label presentation cannot shift', () => {
  for (const r of [rule, darkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting author-layout label rule, the color-inputs label rule and the slice-97 toggle rules are preserved', () => {
  assert.ok(styleCss.match(/\.author-layout label, \.analysis-title, \.rename-sheet label, \.calculation-dialog label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*4px[^}]*margin-bottom:\s*8px/), 'the shared resting author-layout label rule must remain');
  assert.ok(styleCss.match(/\.color-inputs label\s*\{[^}]*width:\s*48px/), 'the color-inputs label resting rule must remain');
  assert.ok(styleCss.match(/^label\.toggle:hover/m), 'the slice-97 toggle label hover must remain');
});

describe('Property-section label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the real ancestor contexts in both chromes, the toggle labels keep their slice-97 tint, and labels outside a property section are out of scope', async () => {
    const ctx = (id, dark) => `<div class="author-workspace" ${dark ? 'data-chrome="dark"' : ''}><div class="author-layout"><aside class="properties-panel">`
      + `<details class="property-section" open><summary>Drill-down hierarchy</summary>`
      + `<label id="${id}Name">Hierarchy name<input value="x"/></label>`
      + `<label id="${id}Dim">Level dimension<select><option>region</option></select></label></details>`
      + `<details class="property-section" open><summary>Pivot options</summary>`
      + `<label id="${id}Width">Column width (px)<input type="number" value="140"/></label>`
      + `<label class="toggle" id="${id}Toggle"><input type="checkbox"/>Hide empty rows</label></details>`
      + `<details class="property-section" open><summary>Analysis theme</summary>`
      + `<label id="${id}Font">Analysis font<select><option>Inter</option></select></label>`
      + `<div class="color-inputs"><label id="${id}Color">Color 1<input type="color" value="#123456"/></label></div></details>`
      + `</aside></div></div>`;
    await page.setContent(`<style>${allCss}</style>` + ctx('l', false) + ctx('d', true)
      + `<label id="outsideLabel">Outside<input/></label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const light = all.find(r => norm(r) === '.property-section label:hover') ?? null;
      const dark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .property-section label:hover') ?? null;
      const toggle = all.find(r => norm(r) === 'label.toggle:hover') ?? null;
      const toggleDark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] label.toggle:hover') ?? null;
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
        lDim: light ? measure(el('lDim'), light) : null,
        lWidth: light ? measure(el('lWidth'), light) : null,
        lFont: light ? measure(el('lFont'), light) : null,
        lColor: light ? measure(el('lColor'), light) : null,
        dName: dark ? measure(el('dName'), dark) : null,
        dDim: dark ? measure(el('dDim'), dark) : null,
        dWidth: dark ? measure(el('dWidth'), dark) : null,
        dFont: dark ? measure(el('dFont'), dark) : null,
        dColor: dark ? measure(el('dColor'), dark) : null,
        lToggle97: toggle ? measure(el('lToggle'), toggle) : null,
        dToggle97: toggleDark ? measure(el('dToggle'), toggleDark) : null,
        toggleMatchesPlain: light ? el('lToggle').matches(light.selectorText.replaceAll(':hover', '')) : null,
        outsideMatches: light ? el('outsideLabel').matches(light.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.ok(actual.foundLight, 'expected the light hover rule in the CSSOM');
    assert.ok(actual.foundDark, 'expected the dark hover rule in the CSSOM');
    for (const props of [actual.propsLight, actual.propsDark]) {
      assert.ok(props.length && props.every(p => p.startsWith('background')), 'hover rules must set background longhands only');
    }
    for (const key of ['lName', 'lDim', 'lWidth', 'lFont', 'lColor']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} label rest (transparent)`);
      assert.equal(actual[key].hovered.background, 'rgb(237, 247, 247)', `${key} label hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} label colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} label geometry`);
    }
    for (const key of ['dName', 'dDim', 'dWidth', 'dFont', 'dColor']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} label rest (transparent)`);
      assert.equal(actual[key].hovered.background, 'rgb(51, 76, 98)', `${key} label hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} label colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} label geometry`);
    }
    assert.equal(actual.lToggle97.hovered.background, 'rgb(237, 247, 247)', 'the light toggle label keeps its slice-97 tint');
    assert.equal(actual.dToggle97.hovered.background, 'rgb(51, 76, 98)', 'the dark toggle label keeps its slice-97 tint');
    assert.equal(actual.toggleMatchesPlain, true, 'the plain rule also covers the toggle labels, at the same tint as slice 97');
    assert.equal(actual.outsideMatches, false, 'a label outside .property-section must be out of scope');
  });
});
