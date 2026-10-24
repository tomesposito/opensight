import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 120: hover feedback for the Create Analysis
// dialog's pagination label (.dataset-picker-pagination label —
// "Items per page" in CreateAnalysisDialog.tsx, wrapping the page-size
// select in the dialog's pagination row). The resting rule
// (.dataset-picker-pagination label { display: flex; align-items:
// center; gap: 8px; }) makes the label a visible surface (text, gap,
// select), but the label had zero hover feedback: slices 16/23 hovered
// the dialog's buttons and the select inside this label, slice 48 its
// search input, and every label :hover rule in the cascade is scoped
// elsewhere (author labels, calculation/analysis-file/data dialogs,
// prep labels, connector/sign-in/collection labels, admin labels,
// embed labels). A CSSOM probe with all five real stylesheets (1,386
// rules) in the real ancestor context (dialog.create-analysis-dialog >
// form > .dataset-picker-pagination > label) confirmed zero matching
// :hover rules for the label and a transparent rest, while the select
// inside it matched the slice-23 select hover. The label now takes
// #edf7fc, the dialog's established hover tint (its button, select and
// search-input hovers), so no new colour is introduced — and because
// the label and the select inside it take the same tint, hovering
// either reads as one surface, not two steps. Background only, so
// resting geometry is identical and there is no animation; the dialog
// is a fixed-light surface, so no dark variant.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = styleCss.match(/^\.dataset-picker-pagination label:hover\s*\{([^}]*)\}/m);

test('the pagination label hover rule exists and uses the established hover tint', () => {
  assert.ok(labelRule, 'expected the dataset-picker-pagination label :hover rule');
  assert.match(labelRule[1], /background:\s*#edf7fc/);
});

test('the hover tint matches the dialog button, select and search-input hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.create-analysis-dialog button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7fc/), 'the dialog button hover must remain #edf7fc');
  assert.ok(styleCss.match(/\.create-analysis-dialog\s+select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7fc/), 'the dialog select hover must remain #edf7fc');
  assert.ok(styleCss.match(/\.create-analysis-dialog input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7fc/), 'the dialog search-input hover must remain #edf7fc');
});

test('the pagination label hover rule is paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(labelRule, 'expected the dataset-picker-pagination label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting pagination rules are preserved', () => {
  assert.ok(styleCss.match(/\.dataset-picker-pagination\s*\{[^}]*display:\s*flex/), 'the resting pagination row rule must remain');
  assert.ok(styleCss.match(/\.dataset-picker-pagination label\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*gap:\s*8px/), 'the resting pagination label rule must remain');
  assert.ok(styleCss.match(/\.dataset-picker-pagination select\s*\{[^}]*padding:\s*3px 6px/), 'the resting pagination select rule must remain');
});

describe('Pagination label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry in the real ancestor context, and labels outside the pagination row are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<dialog class="create-analysis-dialog" open><form>`
      + `<div class="dataset-picker-pagination"><label id="pageLabel">Items per page <select id="pageSelect"><option>25</option></select></label></div>`
      + `<label id="dialogLabel">Other label<input id="dialogInput"/></label>`
      + `</form></dialog>`
      + `<div class="dataset-picker-pagination"><label id="outsideDialogLabel">Items per page <select><option>25</option></select></label></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const label = all.find(r => norm(r) === '.dataset-picker-pagination label:hover') ?? null;
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
        pageLabel: label ? measure(el('pageLabel'), label) : null,
        dialogLabelMatches: label ? el('dialogLabel').matches(label.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.equal(actual.found, true, 'expected the pagination label hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.pageLabel.rest.background, 'rgba(0, 0, 0, 0)', 'pageLabel rest');
    assert.equal(actual.pageLabel.hovered.background, 'rgb(237, 247, 252)', 'pageLabel hover');
    assert.notEqual(actual.pageLabel.rest.background, actual.pageLabel.hovered.background);
    assert.equal(actual.pageLabel.rest.color, actual.pageLabel.hovered.color, 'pageLabel colour unchanged on hover');
    assert.equal(actual.pageLabel.rest.box, actual.pageLabel.hovered.box, 'pageLabel geometry');
    assert.equal(actual.dialogLabelMatches, false, 'a label inside the dialog but outside .dataset-picker-pagination must be out of scope');
  });
});
