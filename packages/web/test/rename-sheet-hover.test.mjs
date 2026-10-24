import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 118: hover feedback for the rename-sheet
// form's label and input (.rename-sheet label / input — "Sheet
// name" in SheetTabs in Author.tsx, shown in the sheet toolbar
// when renaming a sheet). The shared resting rule (.author-layout
// label, .analysis-title, .rename-sheet label, .calculation-dialog
// label) lays the label out as a column flex (text line, 4px gap,
// field), so the label is itself a visible surface, but both the
// label and its input had zero hover feedback: the form's buttons
// hover via .author-workspace button:hover, but the input sits
// outside .author-layout so the author field hovers never reach
// it (the workspace-wide input hovers cover only [type=color] and
// [type=search]), and every label :hover rule in the cascade is
// scoped elsewhere (property-section, parameter-editor,
// sheet-controls, calculation/analysis-file dialogs, O-mode
// notice, connector/sign-in/collection labels, the data-prep
// label series, the change-type label, the admin labels, the
// embed labels). A CSSOM probe with all five real stylesheets
// (1,381 rules) in the real ancestor contexts (author-workspace >
// author-center > sheet-toolbar > form.rename-sheet, light and
// dark chrome) confirmed zero matching :hover rules for both the
// label and the input and a transparent label rest in both
// chromes. The label and input now take #edf7f7, the author
// surface's established hover tint (the author button, field and
// summary hovers and the slices 112-117 label hovers), plus the
// author dark-chrome variant #334c62, so no new colour is
// introduced — and because the label and the field inside it take
// the same tint, hovering either reads as one surface, not two
// steps. Background only, so resting geometry is identical and
// there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = styleCss.match(/^\.rename-sheet label:hover\s*\{([^}]*)\}/m);
const labelDarkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.rename-sheet label:hover\s*\{([^}]*)\}/m);
const inputRule = styleCss.match(/^\.rename-sheet input:hover:not\(:disabled\)\s*\{([^}]*)\}/m);
const inputDarkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.rename-sheet input:hover:not\(:disabled\)\s*\{([^}]*)\}/m);
const allRules = [labelRule, labelDarkRule, inputRule, inputDarkRule];

test('the rename-sheet label and input hover rules exist and use the established hover tints', () => {
  assert.ok(labelRule, 'expected the rename-sheet label :hover rule');
  assert.match(labelRule[1], /background:\s*#edf7f7/);
  assert.ok(inputRule, 'expected the rename-sheet input :hover rule');
  assert.match(inputRule[1], /background:\s*#edf7f7/);
  assert.ok(labelDarkRule, 'expected the author dark-chrome rename-sheet label :hover variant');
  assert.match(labelDarkRule[1], /background:\s*#334c62/);
  assert.ok(inputDarkRule, 'expected the author dark-chrome rename-sheet input :hover variant');
  assert.match(inputDarkRule[1], /background:\s*#334c62/);
});

test('the hover tints match the author field and label hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
  assert.ok(styleCss.match(/^\.property-section label:hover\s*\{[^}]*background:\s*#edf7f7/m), 'the slice-116 property-section label hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-layout input:hover:not\(:disabled\):not\(\[type=radio\]\)[^{]*\{[^}]*background:\s*#edf7f7/), 'the author field hover must remain #edf7f7');
  assert.ok(styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.property-section label:hover\s*\{[^}]*background:\s*#334c62/m), 'the slice-116 dark label hover must remain #334c62');
});

test('the rename-sheet hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  for (const r of allRules) {
    assert.ok(r, 'expected all four hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting rename-sheet and shared label rules are preserved', () => {
  assert.ok(styleCss.match(/\.author-layout label, \.analysis-title, \.rename-sheet label, \.calculation-dialog label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*4px[^}]*margin-bottom:\s*8px/), 'the shared resting label rule must remain');
  assert.ok(styleCss.match(/\.rename-sheet\s*\{[^}]*flex-basis:\s*100%[^}]*display:\s*flex/), 'the rename-sheet form resting rule must remain');
  assert.ok(styleCss.match(/\.rename-sheet label\s*\{[^}]*margin:\s*0/), 'the rename-sheet label resting rule must remain');
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\)/), 'the author button hover for the form buttons must remain');
});

describe('Rename-sheet hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label and input visual state with identical geometry in the real ancestor context in both chromes, and labels/inputs outside the rename form are out of scope', async () => {
    const ctx = (id, dark) => `<div class="author-workspace" ${dark ? 'data-chrome="dark"' : ''}><div class="author-center"><div class="sheet-toolbar">`
      + `<form class="rename-sheet"><label id="${id}Label">Sheet name<input id="${id}Input" value="Sheet 1"/></label>`
      + `<button type="submit">Save name</button><button type="button">Cancel</button></form>`
      + `</div></div></div>`;
    await page.setContent(`<style>${allCss}</style>` + ctx('l', false) + ctx('d', true)
      + `<label id="outsideLabel">Outside<input id="outsideInput"/></label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const label = all.find(r => norm(r) === '.rename-sheet label:hover') ?? null;
      const labelDark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .rename-sheet label:hover') ?? null;
      const input = all.find(r => norm(r) === '.rename-sheet input:hover:not(:disabled)') ?? null;
      const inputDark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .rename-sheet input:hover:not(:disabled)') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        found: { label: !!label, labelDark: !!labelDark, input: !!input, inputDark: !!inputDark },
        props: [label, labelDark, input, inputDark].map(r => r ? [...r.style] : []),
        lLabel: label ? measure(el('lLabel'), label) : null,
        dLabel: labelDark ? measure(el('dLabel'), labelDark) : null,
        lInput: input ? measure(el('lInput'), input) : null,
        dInput: inputDark ? measure(el('dInput'), inputDark) : null,
        outsideLabelMatches: label ? el('outsideLabel').matches(label.selectorText.replaceAll(':hover', '')) : null,
        outsideInputMatches: input ? el('outsideInput').matches(input.selectorText.replaceAll(':hover', '').replaceAll(':not(:disabled)', '')) : null,
      };
    });
    assert.deepEqual(actual.found, { label: true, labelDark: true, input: true, inputDark: true }, 'expected all four hover rules in the CSSOM');
    for (const props of actual.props) {
      assert.ok(props.length && props.every(p => p.startsWith('background')), 'hover rules must set background longhands only');
    }
    for (const [key, tint] of [['lLabel', 'rgb(237, 247, 247)'], ['lInput', 'rgb(237, 247, 247)']]) {
      assert.equal(actual[key].rest.background, key === 'lLabel' ? 'rgba(0, 0, 0, 0)' : 'rgb(255, 255, 255)', `${key} rest`);
      assert.equal(actual[key].hovered.background, tint, `${key} hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} geometry`);
    }
    for (const key of ['dLabel', 'dInput']) {
      assert.equal(actual[key].hovered.background, 'rgb(51, 76, 98)', `${key} hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} geometry`);
    }
    assert.equal(actual.outsideLabelMatches, false, 'a label outside .rename-sheet must be out of scope');
    assert.equal(actual.outsideInputMatches, false, 'an input outside .rename-sheet must be out of scope');
  });
});
