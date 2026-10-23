import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 114: hover feedback for the analysis
// file dialogs' field labels (.analysis-file-dialog label —
// "Analysis name" in SaveAnalysisCopy.tsx; "Analysis name",
// "Description" and "Analysis theme" in AnalysisSettings.tsx;
// "Sheet name", "Layout" and "Optimize for viewing on" in
// NewSheetDialog.tsx; "Row height (pixels)" and "Spacing between
// items (pixels)" in SheetLayoutSettings.tsx). The shared resting
// rule lays every dialog label out as a grid (text line, 4px gap,
// field), so each label is itself a visible surface, but the
// labels had zero hover feedback: every label :hover rule in the
// cascade is scoped elsewhere (author toggles, parameter/action
// editor labels, the O-mode notice label, connector/sign-in/
// collection labels, the data-prep label series, the change-type
// label, the admin labels, the embed labels, the sheet-controls
// labels), so the labels rested transparent and hovering their
// text or gap changed nothing, while only the field inside each
// label tinted via the slice-44 dialog field hover. A CSSOM probe
// with all five real stylesheets (1,374 rules) in the real
// ancestor contexts (author-workspace > dialog.analysis-file-
// dialog, light and dark chrome) confirmed zero matching :hover
// rules for the settings, theme, save-copy, sheet-name and
// dark-chrome layout labels and a transparent rest for all of
// them, and confirmed the input inside the settings label does
// match the slice-44 field hover. This was the fresh zero-hover
// audit on a new surface left by slice 113. The labels now take
// #edf7f7, the author surface's established hover tint (the
// slice-44 dialog field hover and the slice-45 sheet-type-card
// hover in this same dialog family), plus the author dark-chrome
// variant #334c62, so no new colour is introduced — and because
// the inner field's own hover is the same tint, hovering the
// field inside the label reads as one surface, not two steps.
// The New Sheet dialog's disabled sheet-type card keeps slice
// 45's exclusion: it is a label too, so the new rule excludes it
// by the same :not, leaving its subtle resting background and
// not-allowed cursor untouched (the enabled card's own slice-45
// hover already gives it the identical tint). Background only,
// so resting geometry is identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.analysis-file-dialog label:hover:not\(\.sheet-type-card-disabled\)\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.analysis-file-dialog label:hover:not\(\.sheet-type-card-disabled\)\s*\{([^}]*)\}/m);

test('the file-dialog label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .analysis-file-dialog label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tints match the slice-44 dialog field hover and the slice-45 sheet-type-card hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.analysis-file-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\), \.analysis-file-dialog textarea:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-44 dialog field hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.sheet-type-card:hover:not\(\.sheet-type-card-disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-45 sheet-type-card hover must remain #edf7f7');
  assert.ok(darkRule, 'expected the author dark-chrome file-dialog label :hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.analysis-file-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\)[^}]*\{[^}]*background:\s*#334c62/), 'the slice-44 dark dialog field hover must remain #334c62');
});

test('the file-dialog label hover rules are paint-only: resting geometry and label presentation cannot shift', () => {
  for (const r of [rule, darkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting dialog label rule is preserved and the disabled sheet-type card keeps its slice-45 exclusion', () => {
  assert.ok(styleCss.match(/\.analysis-file-dialog label\s*\{[^}]*display:\s*grid[^}]*gap:\s*4px/), 'the resting dialog label rule must remain');
  assert.ok(styleCss.match(/\.analysis-settings-dialog label\s*\{[^}]*margin-top:\s*12px/), 'the settings-dialog label spacing rule must remain');
  assert.ok(styleCss.match(/\.sheet-type-card-disabled\s*\{[^}]*cursor:\s*not-allowed[^}]*background:\s*var\(--chrome-subtle, #f2f6f8\)/), 'the disabled card resting rule must remain');
});

describe('File-dialog label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the real ancestor contexts in both chromes, and the disabled card and outside labels are out of scope', async () => {
    const dialog = (prefix, settings) => `<dialog class="analysis-file-dialog${settings ? ' analysis-settings-dialog' : ''}" open><form>`
      + `<label id="${prefix}Name">Analysis name<input value="x"></label>`
      + (settings ? `<label id="${prefix}Theme">Analysis theme<select><option>Light theme</option></select></label>` : '')
      + `</form></dialog>`;
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="author-workspace">${dialog('l', true)}`
      + `<dialog class="analysis-file-dialog" open><form><label id="lCopy">Analysis name<input value="y"></label></form></dialog>`
      + `<dialog class="analysis-file-dialog analysis-settings-dialog" open><form><div class="sheet-type-cards">`
      + `<label class="sheet-type-card" id="lCard"><input type="radio"><span><strong>Interactive sheet</strong></span></label>`
      + `<label class="sheet-type-card sheet-type-card-disabled" id="lDisabledCard"><input type="radio"><span><strong>Pixel-perfect</strong></span></label>`
      + `</div><label id="lSheet">Sheet name<input value="z"></label></form></dialog></div>`
      + `<div class="author-workspace" data-chrome="dark">${dialog('d', true)}</div>`
      + `<label id="outsideLabel">Outside<input></label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const light = all.find(r => norm(r) === '.analysis-file-dialog label:hover:not(.sheet-type-card-disabled)') ?? null;
      const dark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .analysis-file-dialog label:hover:not(.sheet-type-card-disabled)') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const bare = light ? light.selectorText.replaceAll(':hover', '') : '';
      const el = id => document.querySelector(`#${id}`);
      return {
        foundLight: !!light, foundDark: !!dark,
        propsLight: light ? [...light.style] : [], propsDark: dark ? [...dark.style] : [],
        lName: light ? measure(el('lName'), light) : null,
        lTheme: light ? measure(el('lTheme'), light) : null,
        lCopy: light ? measure(el('lCopy'), light) : null,
        lSheet: light ? measure(el('lSheet'), light) : null,
        dName: dark ? measure(el('dName'), dark) : null,
        dTheme: dark ? measure(el('dTheme'), dark) : null,
        cardMatches: light ? el('lCard').matches(bare) : null,
        disabledMatches: light ? el('lDisabledCard').matches(bare) : null,
        disabledRest: getComputedStyle(el('lDisabledCard')).backgroundColor,
        outsideMatches: light ? el('outsideLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.foundLight, 'expected the light hover rule in the CSSOM');
    assert.ok(actual.foundDark, 'expected the dark hover rule in the CSSOM');
    assert.ok(actual.propsLight.length && actual.propsLight.every(p => p.startsWith('background')), 'light hover rule must set background longhands only');
    assert.ok(actual.propsDark.length && actual.propsDark.every(p => p.startsWith('background')), 'dark hover rule must set background longhands only');
    for (const key of ['lName', 'lTheme', 'lCopy', 'lSheet']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} rest (transparent)`);
      assert.equal(actual[key].hovered.background, 'rgb(237, 247, 247)', `${key} hover`);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} geometry`);
    }
    for (const key of ['dName', 'dTheme']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} rest (transparent)`);
      assert.equal(actual[key].hovered.background, 'rgb(51, 76, 98)', `${key} hover`);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} geometry`);
    }
    assert.equal(actual.cardMatches, true, 'the enabled sheet-type card shares the tint through this scope (its own slice-45 rule gives the identical tint)');
    assert.equal(actual.disabledMatches, false, 'the disabled sheet-type card must stay out of scope');
    assert.equal(actual.disabledRest, 'rgb(242, 246, 248)', 'the disabled card keeps its subtle resting background');
    assert.equal(actual.outsideMatches, false, 'a label outside the file dialogs must be out of scope');
  });
});
