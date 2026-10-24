import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 119: hover feedback for the data dialogs'
// plain labels (.data-dialog label — "Dataset name" in DatasetDetail's
// Duplicate dialog, "Occurrence (minutes)" in DatasetRefresh's schedule
// dialog, "Configured source" and the connector config labels in
// CreateDatasetDialog/DataSources, and the replace panel's label in
// ManageDataDialog). The resting rule (.data-dialog label
// { display: block; }) plus the block field with its margin-top make
// each label a visible surface (text line, field below), but the
// labels had zero hover feedback: slices 30/48 hovered the dialogs'
// buttons and fields, and every other label :hover rule in the cascade
// is scoped elsewhere (author labels, calculation/analysis-file
// dialogs, prep labels, connector/sign-in/collection labels, admin
// labels, embed labels). A CSSOM probe with all five real stylesheets
// (1,385 rules) in the real ancestor context (dialog.data-dialog >
// form > .data-dialog-body > label) confirmed zero matching :hover
// rules for the labels and a transparent rest, while the fields inside
// them matched the data-dialog field hover. The labels now take
// #eaf3f7, the data surface's established hover tint (the dialogs' own
// field and button hovers, slices 30/48, and the data-page hovers), so
// no new colour is introduced — and because the label and the field
// inside it take the same tint, hovering either reads as one surface,
// not two steps. Background only, so resting geometry is identical and
// there is no animation; the data dialogs are fixed-light surfaces, so
// no dark variant. Connector tiles (label.data-connector-tile) already
// hover #eaf3f7 under their own rules, so they are unchanged in effect.
const dataCss = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = dataCss.match(/^\.data-dialog label:hover\s*\{([^}]*)\}/m);

test('the data-dialog label hover rule exists and uses the established hover tint', () => {
  assert.ok(labelRule, 'expected the data-dialog label :hover rule');
  assert.match(labelRule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the data-dialog field and button hovers, so no new colour is introduced', () => {
  assert.ok(dataCss.match(/\.data-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\)[^{]*\{[^}]*background:\s*#eaf3f7/), 'the data-dialog field hover must remain #eaf3f7');
  assert.ok(dataCss.match(/\.data-dialog button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-dialog button hover must remain #eaf3f7');
  assert.ok(dataCss.match(/\.data-page select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page select hover must remain #eaf3f7');
});

test('the data-dialog label hover rule is paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(labelRule, 'expected the data-dialog label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting data-dialog label rules are preserved', () => {
  assert.ok(dataCss.match(/\.data-dialog label\s*\{[^}]*display:\s*block/), 'the resting data-dialog label rule must remain');
  assert.ok(dataCss.match(/\.data-dialog label > input:not\(\[type=radio\]\)\s*\{[^}]*display:\s*block[^}]*margin-top:\s*4px/), 'the resting block-field rule must remain');
  assert.ok(dataCss.match(/\.data-dialog \.data-connector-tile\s*\{[^}]*display:\s*flex/), 'the connector tile label resting rule must remain');
});

describe('Data-dialog label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry in the real ancestor context, and labels outside a data dialog are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<dialog class="data-dialog" open><form><div class="data-dialog-body">`
      + `<label id="nameLabel">Dataset name<input id="nameInput" value="Sales copy"/></label>`
      + `<label id="sourceLabel">Configured source<select id="sourceSelect"><option>PostgreSQL</option></select></label>`
      + `<div class="data-inline-panel"><label id="panelLabel">Replace <strong>Sales</strong> with <select id="panelSelect"><option>Other</option></select></label></div>`
      + `<label class="data-connector-tile" id="tileLabel"><input id="tileRadio" type="radio" name="c"/>PostgreSQL</label>`
      + `</div></form></dialog>`
      + `<label id="outsideLabel">Outside<input id="outsideInput"/></label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const label = all.find(r => norm(r) === '.data-dialog label:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        found: !!label,
        props: label ? [...label.style] : [],
        nameLabel: label ? measure(el('nameLabel'), label) : null,
        sourceLabel: label ? measure(el('sourceLabel'), label) : null,
        panelLabel: label ? measure(el('panelLabel'), label) : null,
        tileLabel: label ? measure(el('tileLabel'), label) : null,
        outsideLabelMatches: label ? el('outsideLabel').matches(label.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.equal(actual.found, true, 'expected the data-dialog label hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    for (const key of ['nameLabel', 'sourceLabel', 'panelLabel', 'tileLabel']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} rest`);
      assert.equal(actual[key].hovered.background, 'rgb(234, 243, 247)', `${key} hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} geometry`);
    }
    assert.equal(actual.outsideLabelMatches, false, 'a label outside .data-dialog must be out of scope');
  });
});
