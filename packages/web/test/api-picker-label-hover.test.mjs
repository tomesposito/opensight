import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 122: hover feedback for the API picker
// form's labels (.api-picker label — "Resource" and "Resource ID" in
// Application.tsx's ApiExplorer form, "Analysis dataset" in
// Author.tsx's dataset chooser). The resting rule (.api-picker label
// { display: flex; flex-direction: column; gap: 8px; }) makes each
// label a visible surface (text line, 8px gap, field), but the labels
// had zero hover feedback: slice 57 hovered the picker's fields and
// its submit button, but every label :hover rule in the cascade is
// scoped elsewhere (property-section, parameter-editor, control-form,
// calculation/analysis-file/data dialogs, prep labels,
// connector/sign-in/collection labels, admin labels, embed labels,
// the action panel body), so the labels rested transparent and
// hovering their text or gap changed nothing, while only the field
// inside each label tinted. A CSSOM probe with all five real
// stylesheets (1,389 rules) in the real ancestor contexts (the
// standalone form.api-picker, and .api-picker inside
// .author-workspace in light and dark chrome) confirmed zero
// matching :hover rules for the labels in all three contexts and a
// transparent rest, while the inner select/input matched the
// slice-57 field hover (plus the author field hovers in the Author
// contexts) and the submit matched the slice-57 button hover. The
// labels now take #edf7f7, the picker's own established hover tint
// (its slice-57 field hover and the author field/button/label
// hovers), plus the author dark-chrome variant #334c62 for the
// Author instance, so no new colour is introduced — and because the
// label and the field inside it take the same tint, hovering either
// reads as one surface, not two steps. Background only, so resting
// geometry is identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = styleCss.match(/^\.api-picker label:hover\s*\{([^}]*)\}/m);
const labelDarkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.api-picker label:hover\s*\{([^}]*)\}/m);

test('the api-picker label hover rules exist and use the established hover tints', () => {
  assert.ok(labelRule, 'expected the api-picker label :hover rule');
  assert.match(labelRule[1], /background:\s*#edf7f7/);
  assert.ok(labelDarkRule, 'expected the author dark-chrome api-picker label :hover variant');
  assert.match(labelDarkRule[1], /background:\s*#334c62/);
});

test('the hover tints match the slice-57 api-picker field hover and the author dark field hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.api-picker select:hover:not\(:disabled\),\s*\.api-picker input:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-57 api-picker field hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark field hover must remain #334c62');
  assert.ok(styleCss.match(/\.api-picker button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#126e76/), 'the slice-57 api-picker button hover must remain #126e76');
});

test('the api-picker label hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  for (const r of [labelRule, labelDarkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting api-picker rules are preserved', () => {
  assert.ok(styleCss.match(/\.api-picker\s*\{[^}]*display:\s*flex/), 'the resting api-picker rule must remain');
  assert.ok(styleCss.match(/\.api-picker label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*8px/), 'the resting api-picker label rule must remain');
  assert.ok(styleCss.match(/\.api-picker button\s*\{[^}]*background:\s*#157f88/), 'the resting api-picker button rule must remain');
});

describe('Api-picker label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the real ancestor contexts, and labels outside the picker are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<form class="api-picker"><label id="soloLabel">Resource<select id="soloSelect"><option>Analysis</option></select></label></form>`
      + `<div class="author-workspace"><div class="api-picker"><label id="authorLabel">Analysis dataset<select><option>Sample</option></select></label></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="api-picker"><label id="darkLabel">Analysis dataset<select><option>Sample</option></select></label></div></div>`
      + `<form><label id="outsideLabel">Outside<input/></label></form>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const label = all.find(r => norm(r) === '.api-picker label:hover') ?? null;
      const labelDark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .api-picker label:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        found: { label: !!label, labelDark: !!labelDark },
        props: [label, labelDark].map(r => r ? [...r.style] : []),
        soloLabel: label ? measure(el('soloLabel'), label) : null,
        authorLabel: label ? measure(el('authorLabel'), label) : null,
        darkLabel: labelDark ? measure(el('darkLabel'), labelDark) : null,
        outsideLabelMatches: label ? el('outsideLabel').matches(label.selectorText.replaceAll(':hover', '')) : null,
        outsideDarkMatches: labelDark ? el('outsideLabel').matches(labelDark.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.deepEqual(actual.found, { label: true, labelDark: true }, 'expected both hover rules in the CSSOM');
    for (const props of actual.props) {
      assert.ok(props.length && props.every(p => p.startsWith('background')), 'hover rules must set background longhands only');
    }
    assert.equal(actual.soloLabel.rest.background, 'rgba(0, 0, 0, 0)', 'standalone label rest');
    assert.equal(actual.soloLabel.hovered.background, 'rgb(237, 247, 247)', 'standalone label hover');
    assert.notEqual(actual.soloLabel.rest.background, actual.soloLabel.hovered.background);
    assert.equal(actual.soloLabel.rest.color, actual.soloLabel.hovered.color, 'standalone label colour unchanged on hover');
    assert.equal(actual.soloLabel.rest.box, actual.soloLabel.hovered.box, 'standalone label geometry');
    assert.equal(actual.authorLabel.rest.background, 'rgba(0, 0, 0, 0)', 'author label rest');
    assert.equal(actual.authorLabel.hovered.background, 'rgb(237, 247, 247)', 'author label hover');
    assert.equal(actual.authorLabel.rest.box, actual.authorLabel.hovered.box, 'author label geometry');
    assert.equal(actual.darkLabel.rest.background, 'rgba(0, 0, 0, 0)', 'dark label rest');
    assert.equal(actual.darkLabel.hovered.background, 'rgb(51, 76, 98)', 'dark label hover');
    assert.equal(actual.darkLabel.rest.color, actual.darkLabel.hovered.color, 'dark label colour unchanged on hover');
    assert.equal(actual.darkLabel.rest.box, actual.darkLabel.hovered.box, 'dark label geometry');
    assert.equal(actual.outsideLabelMatches, false, 'a label outside .api-picker must be out of scope');
    assert.equal(actual.outsideDarkMatches, false, 'a label outside .api-picker must be out of scope for the dark variant');
  });
});
