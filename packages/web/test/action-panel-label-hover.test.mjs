import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 121: hover feedback for the action panel's
// plain field labels (.action-panel-body label — "Action name" and
// "Action type" in ActionEditor.tsx's ActionPanel, "Source field" in
// FilterFields, "URL template" and "Open in" in UrlFields, "Target
// sheet", "Mapped source field" and "Target parameter" in
// NavigationFields). The resting rule (.action-panel-body label
// { display: grid; gap: 4px; }) makes each label a visible surface
// (text line, 4px gap, field), but the plain labels had zero hover
// feedback: every label :hover rule in the cascade is scoped
// elsewhere (property-section, parameter-editor, control-form,
// calculation/analysis-file/data dialogs, prep labels,
// connector/sign-in/collection labels, admin labels, embed labels),
// and the panel's own label hovers cover only its radio/checkbox
// labels via the :has rules, so the plain labels rested transparent
// and hovering their text or gap changed nothing, while only the
// field inside each label tinted via the author field hovers. A
// CSSOM probe with all five real stylesheets (1,387 rules) in the
// real ancestor context (author-workspace > author-layout >
// .action-panel > .action-panel-body) confirmed zero matching
// :hover rules for the plain labels and a transparent rest, while
// the radio/checkbox labels matched the :has hovers and the inner
// input/select matched the author field hovers. The labels now take
// #edf7f7, the author surface's established hover tint (the panel's
// own :has label hovers, the author field, button and summary
// hovers, and the slices 112-120 label hovers), plus the author
// dark-chrome variant #334c62, so no new colour is introduced — and
// because the label and the field inside it take the same tint,
// hovering either reads as one surface, not two steps. The :has
// rules carry higher specificity with the same tints, so the
// radio/checkbox labels are unchanged whichever rule wins.
// Background only, so resting geometry is identical and there is
// no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = styleCss.match(/^\.action-panel-body label:hover\s*\{([^}]*)\}/m);
const labelDarkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.action-panel-body label:hover\s*\{([^}]*)\}/m);

test('the action-panel label hover rules exist and use the established hover tints', () => {
  assert.ok(labelRule, 'expected the action-panel-body label :hover rule');
  assert.match(labelRule[1], /background:\s*#edf7f7/);
  assert.ok(labelDarkRule, 'expected the author dark-chrome action-panel-body label :hover variant');
  assert.match(labelDarkRule[1], /background:\s*#334c62/);
});

test('the hover tints match the panel :has label hovers and the author field hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.action-radio-group label:has\(> input\[type=radio\]\):hover\s*\{[^}]*background:\s*#edf7f7/), 'the panel radio label hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.action-checkbox-list label:has\(> input\[type=checkbox\]\):hover\s*\{[^}]*background:\s*#edf7f7/), 'the panel checkbox label hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-layout input:hover:not\(:disabled\):not\(\[type=radio\]\)[^{]*\{[^}]*background:\s*#edf7f7/), 'the author field hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.action-radio-group label:has\(> input\[type=radio\]\):hover\s*\{[^}]*background:\s*#334c62/), 'the dark panel radio label hover must remain #334c62');
});

test('the action-panel label hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  for (const r of [labelRule, labelDarkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting action-panel rules are preserved', () => {
  assert.ok(styleCss.match(/\.action-panel-body\s*\{[^}]*display:\s*grid/), 'the resting action-panel-body rule must remain');
  assert.ok(styleCss.match(/\.action-panel-body label\s*\{[^}]*display:\s*grid[^}]*gap:\s*4px/), 'the resting action-panel-body label rule must remain');
  assert.ok(styleCss.match(/\.action-radio-group label\s*\{[^}]*display:\s*flex/), 'the resting radio-group label rule must remain');
});

describe('Action-panel label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the real ancestor context in both chromes, and labels outside the panel body are out of scope', async () => {
    const ctx = (id, dark) => `<div class="author-workspace" ${dark ? 'data-chrome="dark"' : ''}><div class="author-layout"><div class="action-panel"><div class="action-panel-body">`
      + `<label id="${id}Label">Action name<input id="${id}Input"/></label>`
      + `<fieldset class="action-radio-group"><label id="${id}Radio"><input type="radio" checked/>Select</label></fieldset>`
      + `</div></div></div></div>`;
    await page.setContent(`<style>${allCss}</style>` + ctx('l', false) + ctx('d', true)
      + `<div class="author-workspace"><div class="author-layout"><label id="outsideLabel">Outside<input/></label></div></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const label = all.find(r => norm(r) === '.action-panel-body label:hover') ?? null;
      const labelDark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .action-panel-body label:hover') ?? null;
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
        lLabel: label ? measure(el('lLabel'), label) : null,
        dLabel: labelDark ? measure(el('dLabel'), labelDark) : null,
        outsideLabelMatches: label ? el('outsideLabel').matches(label.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.deepEqual(actual.found, { label: true, labelDark: true }, 'expected both hover rules in the CSSOM');
    for (const props of actual.props) {
      assert.ok(props.length && props.every(p => p.startsWith('background')), 'hover rules must set background longhands only');
    }
    assert.equal(actual.lLabel.rest.background, 'rgba(0, 0, 0, 0)', 'light label rest');
    assert.equal(actual.lLabel.hovered.background, 'rgb(237, 247, 247)', 'light label hover');
    assert.notEqual(actual.lLabel.rest.background, actual.lLabel.hovered.background);
    assert.equal(actual.lLabel.rest.color, actual.lLabel.hovered.color, 'light label colour unchanged on hover');
    assert.equal(actual.lLabel.rest.box, actual.lLabel.hovered.box, 'light label geometry');
    assert.equal(actual.dLabel.rest.background, 'rgba(0, 0, 0, 0)', 'dark label rest');
    assert.equal(actual.dLabel.hovered.background, 'rgb(51, 76, 98)', 'dark label hover');
    assert.equal(actual.dLabel.rest.color, actual.dLabel.hovered.color, 'dark label colour unchanged on hover');
    assert.equal(actual.dLabel.rest.box, actual.dLabel.hovered.box, 'dark label geometry');
    assert.equal(actual.outsideLabelMatches, false, 'a label outside .action-panel-body must be out of scope');
  });
});
