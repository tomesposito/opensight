import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 81: hover feedback for the dataset
// detail's "Storage settings" disclosure summary (the bare
// <details> in DatasetDetail.tsx's About card — the only details
// inside .data-summary-cards, rendered unconditionally on the
// dataset Summary tab). Every other control on the data detail
// tints #eaf3f7 on hover — buttons via .data-page button:hover,
// the selected tab (slice 28), the filter select (slice 21), the
// search input (slice 27) and the row-menu summary (.data-row-menu
// summary:hover) — but a summary is none of those elements, and
// every summary:hover rule in the cascade is scoped elsewhere
// (.author-workspace, .prep-*, .calculation-dialog, .card-footer,
// .account-menu, .data-menu, .first-run), so hovering "Storage
// settings" changed nothing; its only rules are the global cursor
// and the slice-15 :active press. A CSSOM probe with the real
// stylesheets confirmed zero matching :hover rules. The dataset
// detail is a sub-route reached by opening a dataset, so top-level
// route audits never hover it (the slices 50/62/64/67/68 blind
// spot). It now takes the data surface's established hover tint
// (#eaf3f7), so no new colour is introduced. Background only, so
// resting geometry is identical and there is no animation; the
// data detail surface is fixed light, so no dark variant is added.
const css = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const rule = css.match(/\.data-summary-cards details > summary:hover\s*\{([^}]*)\}/);

test('the Storage settings summary hover rule exists and uses the data surface tint', () => {
  assert.ok(rule, 'expected the .data-summary-cards details > summary:hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint is the established data-surface hover tint, distinct from the transparent rest', () => {
  assert.ok(css.match(/\.data-page button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page button hover must remain #eaf3f7');
  assert.ok(css.match(/\.data-row-menu summary:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the row-menu summary hover must remain #eaf3f7');
  assert.notEqual('#eaf3f7', 'transparent', 'the hover tint must differ from the resting state');
});

test('the summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting data-summary-cards rules are preserved', () => {
  assert.ok(css.match(/\.data-summary-cards\s*\{[^}]*display:\s*grid/), 'the summary-cards layout rule must remain');
  assert.ok(css.match(/\.data-summary-cards button\s*\{[^}]*border:\s*0; padding:\s*0/), 'the summary-cards button rule must remain');
  assert.ok(css.match(/\.data-summary-cards \.dataset-execution\s*\{[^}]*padding:\s*8px 0/), 'the embedded execution panel rule must remain');
});

test('the neighbouring data hover rules are untouched', () => {
  assert.ok(css.match(/\.data-split > \.data-menu > summary:hover\s*\{[^}]*background:\s*#145d76/), 'the slice-16 data-menu summary hover must remain #145d76');
  assert.ok(css.match(/\.data-tabs button\[aria-selected=true\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the slice-28 selected data-tab hover must remain #eaf3f7');
  assert.ok(css.match(/\.data-page select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the slice-21 filter select hover must remain #eaf3f7');
  assert.ok(css.match(/\.data-page input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the slice-27 search input hover must remain #eaf3f7');
});

describe('Storage settings summary hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<section class="data-page data-detail"><div class="data-summary"><aside class="data-summary-cards"><section class="data-card"><h2>About</h2><details><summary id="s">Storage settings</summary><p>Execution</p></details></section></aside></div></section>`
      + `<details><summary id="outside">Outside summary</summary></details>`
      + `<aside class="data-summary-cards"><summary id="no-details">Not in details</summary></aside>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.data-summary-cards details > summary:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const matches = (el, rule) => rule ? el.matches(rule.selectorText.replaceAll(':hover', '')) : null;
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        s: found ? measure(document.querySelector('#s'), found) : null,
        outsideMatches: matches(document.querySelector('#outside'), found),
        noDetailsMatches: matches(document.querySelector('#no-details'), found),
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.s.rest.background, 'rgba(0, 0, 0, 0)', 'summary rest');
    assert.equal(actual.s.hovered.background, 'rgb(234, 243, 247)', 'summary hover');
    assert.notEqual(actual.s.rest.background, actual.s.hovered.background);
    assert.equal(actual.s.rest.box, actual.s.hovered.box, 'summary geometry');
    assert.equal(actual.outsideMatches, false, 'a summary outside .data-summary-cards must be out of scope');
    assert.equal(actual.noDetailsMatches, false, 'a summary not inside a details must be out of scope');
  });
});
