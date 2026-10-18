import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 23: hover feedback for the pagination "Items per
// page" selects. A fresh interactive-state audit (home/analyses/dashboards/
// data + the Create Analysis dialog; in-page CLS 0 on every route, no page
// errors, no slow scroll frames) found these two selects were the last
// interactive controls with zero hover state: hovering them changed nothing.
// - The Create Analysis dialog's select takes the dialog's established button
//   hover tint (#edf7fc, same rule family as the dialog's buttons).
// - The drafts collection's `.collection-pagination` select takes the
//   app-wide menu-item hover tint (#eaf3f7, slices 16/21).
// Both are background-only (paint, no geometry shift), disabled selects keep
// their flat state, and there is no animation so no reduced-motion variant is
// needed.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const chromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

const dialogRule = styleCss.match(/\.create-analysis-dialog\s+select:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const collectionRule = chromeCss.match(/\.collection-pagination\s+select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the Create Analysis dialog pagination select has a hover state with the dialog tint', () => {
  assert.ok(dialogRule, 'expected .create-analysis-dialog select:hover:not(:disabled)');
  assert.match(dialogRule[1], /background:\s*#edf7fc/);
});

test('the drafts collection pagination select has a hover state with the menu tint', () => {
  assert.ok(collectionRule, 'expected .collection-pagination select:hover:not(:disabled)');
  assert.match(collectionRule[1], /background:\s*#eaf3f7/);
});

test('both hover rules are paint-only: resting geometry cannot shift', () => {
  for (const [name, rule] of [['dialog', dialogRule], ['collection', collectionRule]]) {
    assert.ok(rule, `expected ${name} hover rule`);
    assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(rule[1]), `${name}: hover must change background only`);
  }
});

test('the dialog select resting rule still reserves the geometry the hover keeps', () => {
  const base = styleCss.match(/\.create-analysis-dialog\s+button,\s*\.create-analysis-dialog\s+select\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the dialog base control rule');
  assert.match(base[1], /background:\s*#fff/);
});

describe('pagination select hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying each hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${styleCss}</style><style>${chromeCss}</style>`
      + `<dialog class="create-analysis-dialog" open><div class="dataset-picker-pagination"><label>Items per page <select id="dlg"><option>25</option></select></label></div></dialog>`
      + `<section class="local-drafts"><div class="collection-pagination"><label>Items per page <select id="col"><option>25</option></select></label><select id="dis" disabled><option>25</option></select></div></section>`);
    const actual = await page.evaluate(() => {
      const find = (sheet, text) => {
        const hits = [];
        for (const s of document.styleSheets) for (const r of s.cssRules) if (r.selectorText === text) hits.push(r);
        return hits;
      };
      const check = (el, selectorText, tint) => {
        const rules = find(document, selectorText);
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        for (const prop of rules[0].style) el.style.setProperty(prop, rules[0].style.getPropertyValue(prop));
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { ruleCount: rules.length, rest, hovered, backgroundColor: rules[0].style.getPropertyValue('background-color') };
      };
      const dlg = document.querySelector('#dlg');
      const col = document.querySelector('#col');
      const dis = document.querySelector('#dis');
      return {
        dialog: check(dlg, '.create-analysis-dialog select:hover:not(:disabled)'),
        collection: check(col, '.collection-pagination select:hover:not(:disabled)'),
        disabledRest: getComputedStyle(dis).backgroundColor,
        disabledMatches: dis.matches('.collection-pagination select:hover:not(:disabled)'),
      };
    });
    assert.equal(actual.dialog.ruleCount, 1);
    assert.equal(actual.dialog.backgroundColor, 'rgb(237, 247, 252)');
    assert.equal(actual.dialog.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.dialog.hovered.background, 'rgb(237, 247, 252)');
    assert.equal(actual.dialog.rest.box, actual.dialog.hovered.box);
    assert.equal(actual.collection.ruleCount, 1);
    assert.equal(actual.collection.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.collection.hovered.background, 'rgb(234, 243, 247)');
    assert.equal(actual.collection.rest.box, actual.collection.hovered.box);
    assert.equal(actual.disabledMatches, false);
    assert.equal(actual.disabledRest, 'rgb(255, 255, 255)');
  });
});
