import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 112: hover feedback for the sheet
// controls strip's field labels (.parameter-control label — the
// on-sheet control's own label in ControlInput.tsx, wrapping its
// select, range slider or text/date input; .control-settings
// label — "Bound parameter" in the per-control Edit details in
// ControlsStrip.tsx; and .control-form label — the Add-control
// form's "Control label", "Parameter", "Control type", "Options
// source", "Options (one per line)", "Cascade from", "Parent
// filter column" and "Minimum" / "Maximum" / "Step"). The shared
// resting rule lays all three label types out as column flexes
// (text line, 4px gap, field), so each label is itself a visible
// surface, but the labels had zero hover feedback: every label
// :hover rule in the cascade is scoped elsewhere (author toggles,
// parameter/action editor labels, the O-mode notice label,
// connector/sign-in/collection labels, the data-prep label series,
// the change-type label, the admin labels, the embed labels), so
// the labels rested transparent and hovering their text or gap
// changed nothing, while only the field inside each label tinted
// via the author field hovers — and the slider's range input is
// deliberately excluded from the author field hover, so the
// slider label was fully dead on hover. A CSSOM probe with all
// five real stylesheets (1,371 rules) in the real ancestor
// contexts (author-workspace > author-layout > author-center >
// controls-strip, light and dark chrome) confirmed zero matching
// :hover rules for all eight label variants and a transparent
// rest in both chromes. This was the fresh zero-hover audit on a
// new surface left by slice 111. The labels now take #edf7f7, the
// author surface's established hover tint (the author button,
// field and summary hovers, and the slice-83 control-settings
// summary hover in this same strip), plus the author dark-chrome
// variant #334c62, so no new colour is introduced — and because
// the inner field's own hover is the same tint, hovering the
// field inside the label reads as one surface, not two steps.
// Background only, so resting geometry is identical and there is
// no animation. The .parameter-editor plain labels share the
// resting rule but stay out of scope: they are a different surface
// (the Data panel), and their checkbox labels are slice 99.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/\.parameter-control label:hover,\s*\.control-settings label:hover,\s*\.control-form label:hover\s*\{([^}]*)\}/);
const darkRule = styleCss.match(/\.author-workspace\[data-chrome=dark\] \.parameter-control label:hover,\s*\.author-workspace\[data-chrome=dark\] \.control-settings label:hover,\s*\.author-workspace\[data-chrome=dark\] \.control-form label:hover\s*\{([^}]*)\}/);

test('the controls label hover rule exists for all three controls label contexts and uses the established hover tint', () => {
  assert.ok(rule, 'expected the grouped controls label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tints match the author field/button hovers and the slice-83 summary hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.control-settings summary:hover\s*\{[^}]*background:\s*#edf7f7/), 'the slice-83 control-settings summary hover must remain #edf7f7');
  assert.ok(darkRule, 'expected the author dark-chrome controls label :hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.control-settings summary:hover\s*\{[^}]*background:\s*#334c62/), 'the slice-83 dark summary hover must remain #334c62');
});

test('the controls label hover rules are paint-only: resting geometry and label presentation cannot shift', () => {
  for (const r of [rule, darkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting controls label rule is preserved and the parameter-editor labels stay out of this slice\u2019s scope', () => {
  assert.ok(styleCss.match(/\.parameter-control label, \.control-settings label, \.control-form label, \.parameter-editor label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*4px[^}]*margin-bottom:\s*8px/), 'the shared resting label rule must remain');
  // The parameter-editor plain labels were out of scope for slices
  // 112/113 (a different surface, the Data panel); slice 114 later
  // covered them with their own rule at the same author tint, which
  // parameter-editor-label-hover.test.mjs now guards. This slice's
  // grouped rule must still not reach them.
  assert.ok(!rule[0].includes('parameter-editor'), 'the controls label hover rule must not cover the parameter-editor labels');
});

describe('Controls label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the real ancestor contexts in both chromes, and labels outside the controls contexts are out of scope', async () => {
    const strip = (id, dark) => `<div class="author-workspace" ${dark ? 'data-chrome="dark"' : ''}><div class="author-layout"><div class="author-center">`
      + `<section class="controls-strip"><div class="controls-row"><div class="control-container">`
      + `<div class="parameter-control"><label id="${id}Pc">Region<select><option>a</option></select></label></div>`
      + `<div class="parameter-control"><label id="${id}Slider">Amount<input type="range" min="0" max="10"/><output>5</output></label></div>`
      + `<details class="control-settings" open><summary>Edit Region</summary><label id="${id}Cs">Bound parameter<select><option>p</option></select></label></details>`
      + `</div></div>`
      + `<form class="control-form"><label id="${id}Cf">Control label<input value="x"/></label></form>`
      + `</section></div></div></div>`;
    await page.setContent(`<style>${allCss}</style>` + strip('l', false) + strip('d', true)
      + `<div class="author-workspace"><details class="parameter-editor" open><summary>Parameters</summary><form><label id="peLabel">Parameter name<input value="y"/></label></form></details></div>`
      + `<label id="outsideLabel">Outside<input/></label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const light = all.find(r => norm(r) === '.parameter-control label:hover, .control-settings label:hover, .control-form label:hover') ?? null;
      const dark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .parameter-control label:hover, .author-workspace[data-chrome=dark] .control-settings label:hover, .author-workspace[data-chrome=dark] .control-form label:hover') ?? null;
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
        lPc: light ? measure(el('lPc'), light) : null,
        lSlider: light ? measure(el('lSlider'), light) : null,
        lCs: light ? measure(el('lCs'), light) : null,
        lCf: light ? measure(el('lCf'), light) : null,
        dPc: dark ? measure(el('dPc'), dark) : null,
        dSlider: dark ? measure(el('dSlider'), dark) : null,
        dCs: dark ? measure(el('dCs'), dark) : null,
        dCf: dark ? measure(el('dCf'), dark) : null,
        peMatches: light ? el('peLabel').matches(light.selectorText.replaceAll(':hover', '')) : null,
        outsideMatches: light ? el('outsideLabel').matches(light.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.ok(actual.foundLight, 'expected the light hover rule in the CSSOM');
    assert.ok(actual.foundDark, 'expected the dark hover rule in the CSSOM');
    for (const props of [actual.propsLight, actual.propsDark]) {
      assert.ok(props.length && props.every(p => p.startsWith('background')), 'hover rules must set background longhands only');
    }
    for (const key of ['lPc', 'lSlider', 'lCs', 'lCf']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} label rest (transparent)`);
      assert.equal(actual[key].hovered.background, 'rgb(237, 247, 247)', `${key} label hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} label colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} label geometry`);
    }
    for (const key of ['dPc', 'dSlider', 'dCs', 'dCf']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} label rest (transparent)`);
      assert.equal(actual[key].hovered.background, 'rgb(51, 76, 98)', `${key} label hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} label colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} label geometry`);
    }
    assert.equal(actual.peMatches, false, 'a parameter-editor plain label must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a label outside the author workspace must be out of scope');
  });
});
