import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 134: hover feedback for the Data panel's
// "Search fields" label (.fields-panel .panel-content > label in
// Author.tsx — the text line plus its search input at the top of the
// author Data panel). The shared .author-layout label rule lays the
// label out as a column flex (text line, 4px gap, field), so the label
// is itself a visible surface, but the label had zero hover feedback:
// every label :hover rule in the cascade is scoped elsewhere
// (property sections, panels, dialogs, the data-prep series, the
// embed/admin/connector scopes), so the label rested transparent and
// hovering its text or gap changed nothing, while only the input
// inside it tinted via the author-layout input hover. A CSSOM probe
// with all five real stylesheets (1,408 rules) in the real ancestor
// context (.author-workspace[data-chrome] > .author-layout >
// details.builder-panel.fields-panel > .panel-content) confirmed zero
// matching :hover rules for the label and a transparent rest in both
// chromes, while the inner input matched the author-layout input
// hover. The label now takes the input's own hover tint (#edf7f7;
// dark chrome #334c62 — the fixture-picker / chrome-switch precedent:
// the label takes its field's hover tint), so no new colour is
// introduced and label and field read as one surface. The scope is
// the direct child of .panel-content, so the dataset header's
// execution-controls labels nested in their section keep their own
// slice-128 rules (the same tints) and the field-group rows are out
// of scope. Background only, so resting geometry is identical and
// there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = styleCss.match(/^\.fields-panel \.panel-content > label:hover\s*\{([^}]*)\}/m);
const darkLabelRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.fields-panel \.panel-content > label:hover\s*\{([^}]*)\}/m);

test('the search-fields label hover rules exist and use the established author tints', () => {
  assert.ok(labelRule, 'expected the .fields-panel .panel-content > label:hover rule');
  assert.match(labelRule[1], /background:\s*#edf7f7/);
  assert.ok(darkLabelRule, 'expected the dark-chrome search-fields label :hover variant');
  assert.match(darkLabelRule[1], /background:\s*#334c62/);
});

test('the hover tints match the author-layout input hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/^\.author-layout input:hover[^{]*\{[^}]*background:\s*#edf7f7/m), 'the author-layout input hover must remain #edf7f7');
  assert.ok(styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.author-layout input:hover[^{]*\{[^}]*background:\s*#334c62/m), 'the dark author-layout input hover must remain #334c62');
});

test('the label hover rules are paint-only: resting geometry and text colour cannot shift', () => {
  for (const rule of [labelRule, darkLabelRule]) {
    assert.ok(rule, 'expected both search-fields label :hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the resting author-layout label rule and the fields-panel structure rules are preserved', () => {
  assert.ok(styleCss.match(/\.author-layout label, \.analysis-title, \.rename-sheet label, \.calculation-dialog label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*4px/), 'the shared resting author-layout label rule must remain');
  assert.ok(styleCss.match(/\.author-layout:has\(> \.fields-panel:not\(\[open\]\)\)\s*\{[^}]*--data-width:\s*44px/), 'the collapsed fields-panel width rule must remain');
});

describe('search-fields label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in both chromes, its input takes the same tint, and nested or other-panel labels are out of scope', async () => {
    const panel = (id, extra = '') => `<details class="builder-panel fields-panel" open><summary>Data</summary><div class="panel-content"><section class="dataset-header"><div class="execution-controls"><label id="${id}Nested">Execution mode<select><option>BLAZE</option></select></label></div></section><label id="${id}">Search fields<input id="${id}Input" type="search"/></label>${extra}</div></details>`;
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-layout">${panel('light')}</div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout">${panel('dark')}</div></div>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-layout"><details class="builder-panel build-panel" open><summary>Build</summary><div class="panel-content"><label id="otherPanel">Other<input/></label></div></details></div></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const rule = all.find(r => norm(r) === '.fields-panel .panel-content > label:hover') ?? null;
      const darkRule = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .fields-panel .panel-content > label:hover') ?? null;
      const inputRule = all.find(r => norm(r).includes('.author-layout input:hover')) ?? null;
      const el = id => document.querySelector(`#${id}`);
      const measure = (target, found) => {
        const rest = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        if (found) target.style.cssText = found.style.cssText;
        const hovered = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        target.removeAttribute('style');
        return { rest, hovered };
      };
      return {
        found: !!rule, darkFound: !!darkRule,
        props: rule ? [...rule.style] : [], darkProps: darkRule ? [...darkRule.style] : [],
        light: rule ? measure(el('light'), rule) : null,
        dark: darkRule ? measure(el('dark'), darkRule) : null,
        input: inputRule ? measure(el('lightInput'), inputRule) : null,
        nestedMatches: el('lightNested').matches('.fields-panel .panel-content > label'),
        otherPanelMatches: el('otherPanel').matches('.fields-panel .panel-content > label'),
      };
    });
    assert.equal(actual.found, true, 'expected the hover rule in the CSSOM');
    assert.equal(actual.darkFound, true, 'expected the dark hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.ok(actual.darkProps.length && actual.darkProps.every(p => p.startsWith('background')), 'dark hover rule must set background longhands only');
    assert.equal(actual.light.rest.background, 'rgba(0, 0, 0, 0)', 'light label rest');
    assert.equal(actual.light.hovered.background, 'rgb(237, 247, 247)', 'light label hover (#edf7f7)');
    assert.equal(actual.light.rest.color, actual.light.hovered.color, 'light label colour unchanged on hover');
    assert.equal(actual.light.rest.box, actual.light.hovered.box, 'light label geometry');
    assert.equal(actual.dark.rest.background, 'rgba(0, 0, 0, 0)', 'dark label rest');
    assert.equal(actual.dark.hovered.background, 'rgb(51, 76, 98)', 'dark label hover (#334c62)');
    assert.equal(actual.dark.rest.box, actual.dark.hovered.box, 'dark label geometry');
    assert.equal(actual.input.hovered.background, 'rgb(237, 247, 247)', 'the search input hover takes the same tint, so label and field read as one surface');
    assert.equal(actual.nestedMatches, false, 'a label nested in the dataset-header section must not match the direct-child selector');
    assert.equal(actual.otherPanelMatches, false, 'a label in another panel must not match the fields-panel selector');
  });
});
