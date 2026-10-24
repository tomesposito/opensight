import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 131: hover feedback for the connector
// details labels (.connector-details label — "File" and the
// schema-field labels in DataSources.tsx's ConnectorDetails form,
// plus "Data expires" in DirectUpload.tsx's section.direct-upload,
// all inside aside.connector-details). The resting rule
// (.connector-details form, .connector-details label
// { display: grid; gap: 7px; }) makes each label a visible surface
// (text line, gap, field). In the Create Dataset dialog the SAME
// ConnectorDetails labels already hover via .data-dialog label:hover
// (#eaf3f7), but on the standalone gallery surface (app-shell > main
// > section.data-sources > .connector-layout > aside.connector-details)
// every label :hover rule in the cascade is scoped elsewhere (data
// dialog, data-prep, author, admin, collection, embed, sign-in
// scopes), so the labels rested transparent and hovering their text
// or gap changed nothing, while the fields inside them tint via the
// slice-91 field hover and the aside's plain buttons (slice 93),
// submit (slice 66) and toggle label (slice 94) do step. A CSSOM
// probe with all five real stylesheets (1,405 rules) in the real
// ancestor contexts confirmed zero matching :hover rules and a
// transparent rest for the gallery form label, the file label and
// the DirectUpload label, the data-dialog rule alone for the dialog
// label, and the slice-91 field hover for the inner fields (the file
// input itself is excluded from the field hover by design). The
// labels now take #eaf3f7 — the tint these same labels already take
// inside the data-dialog, and the gallery's own field (slice 91),
// plain-button (slice 93) and toggle-label (slice 94) hovers — so no
// new colour is introduced and label and field read as one surface.
// The rule is not surface-scoped: in the dialog context it sets the
// identical tint to the data-dialog rule, so the dialog is
// unchanged. The rule is on the label, not the inner control, so
// the file input keeps its native rendering (the slice-94/95 label
// precedent). Background only, so resting geometry is identical and
// there is no animation; the gallery is a fixed-light surface, so
// no dark variant is added.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const dataCss = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = styleCss.match(/^\.connector-details label:hover\s*\{([^}]*)\}/m);

test('the connector-details label hover rule exists and uses the established gallery tint', () => {
  assert.ok(labelRule, 'expected the .connector-details label:hover rule');
  assert.match(labelRule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the data-dialog label hover these same labels already take in the dialog, and the slice-91 field hover, so no new colour is introduced', () => {
  assert.ok(dataCss.match(/\.data-dialog label:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the data-dialog label hover must remain #eaf3f7');
  assert.ok(styleCss.match(/\.connector-details input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\), \.connector-details select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the slice-91 connector-details field hover must remain #eaf3f7');
});

test('the label hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(labelRule, 'expected the label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting connector-details label rules are preserved and the file input still has no hover rule of its own', () => {
  assert.ok(styleCss.match(/\.connector-details form, \.connector-details label\s*\{[^}]*display:\s*grid[^}]*gap:\s*7px/), 'the resting connector-details label layout rule must remain');
  assert.ok(styleCss.match(/\.connector-details label\s*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*600/), 'the resting connector-details label text rule must remain');
  assert.ok(!/\.connector-details input\[type=file\]:hover/.test(styleCss), 'the file input must keep its native rendering with no hover rule of its own');
});

describe('Connector-details label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the gallery labels visual state with identical geometry, the dialog label keeps its tint, the inner field keeps the slice-91 hover, and a label outside .connector-details is out of scope', async () => {
    const form = ids => `<form><label id="${ids[0]}">Format *<select><option>CSV</option></select></label><label id="${ids[1]}">File<input type="file"></label></form>`
      + `<section class="direct-upload"><label id="${ids[2]}">Data expires<input type="datetime-local"></label></section>`;
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="app-shell"><main><section class="data-sources"><div class="connector-layout"><aside class="connector-details">${form(['fieldLabel', 'fileLabel', 'expiresLabel'])}</aside></div></section></main></div>`
      + `<div class="data-dialog"><aside class="connector-details">${form(['dFieldLabel', 'dFileLabel', 'dExpiresLabel'])}</aside></div>`
      + `<main><label id="outsideLabel">Outside<input type="text"></label></main>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const find = sel => all.find(r => norm(r) === sel) ?? null;
      const labelRuleFound = find('.connector-details label:hover');
      const dialogRule = find('.data-dialog label:hover');
      const fieldRule = all.find(r => norm(r).includes('.connector-details select:hover')) ?? null;
      const el = id => document.querySelector(`#${id}`);
      const measure = (target, found) => {
        const rest = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        if (found) { for (const prop of found.style) target.style.setProperty(prop, found.style.getPropertyValue(prop), found.style.getPropertyPriority(prop)); }
        const hovered = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        target.removeAttribute('style');
        return { rest, hovered };
      };
      return {
        found: !!labelRuleFound,
        props: labelRuleFound ? [...labelRuleFound.style] : [],
        field: labelRuleFound ? measure(el('fieldLabel'), labelRuleFound) : null,
        file: labelRuleFound ? measure(el('fileLabel'), labelRuleFound) : null,
        expires: labelRuleFound ? measure(el('expiresLabel'), labelRuleFound) : null,
        dialog: dialogRule ? measure(el('dFieldLabel'), dialogRule) : null,
        dialogMatchesNew: el('dFieldLabel').matches('.connector-details label'),
        innerSelect: fieldRule ? measure(el('fieldLabel').querySelector('select'), fieldRule) : null,
        outsideMatches: el('outsideLabel').matches('.connector-details label'),
      };
    });
    assert.equal(actual.found, true, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    for (const kind of ['field', 'file', 'expires']) {
      assert.equal(actual[kind].rest.background, 'rgba(0, 0, 0, 0)', `${kind} label rest is transparent`);
      assert.equal(actual[kind].hovered.background, 'rgb(234, 243, 247)', `${kind} label hover`);
      assert.notEqual(actual[kind].rest.background, actual[kind].hovered.background);
      assert.equal(actual[kind].rest.color, actual[kind].hovered.color, `${kind} label colour unchanged on hover`);
      assert.equal(actual[kind].rest.box, actual[kind].hovered.box, `${kind} label geometry`);
    }
    assert.equal(actual.dialog.hovered.background, 'rgb(234, 243, 247)', 'the dialog label keeps its data-dialog hover tint');
    assert.equal(actual.dialogMatchesNew, true, 'the dialog label is also a connector-details label, taking the identical tint');
    assert.equal(actual.innerSelect.hovered.background, 'rgb(234, 243, 247)', 'the inner select keeps its slice-91 hover tint, so label and field read as one surface');
    assert.equal(actual.outsideMatches, false, 'a label outside .connector-details must be out of scope');
  });
});
