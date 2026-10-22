import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 86: hover feedback for the plain AppLink
// links on the dataset detail page (DatasetDetail.tsx — the
// .data-breadcrumb "Datasets" link, the standalone "‹ Datasets" link
// under it, the Usage tab's analysis/dependent-dataset table links,
// and the not-found branch's "‹ Datasets" link). AppLink
// (AppNavigation.tsx) renders a plain <a> with no class and no
// resting rule targets it, so it kept the pure UA default
// (transparent background, default link blue, underline) and matched
// no :hover rule: every a:hover in the cascade is scoped elsewhere
// (.app-nav/.section-nav, .fixture-notice, .first-run-docs,
// .product-header .breadcrumbs — plural and inside the product
// header — the rail/folder/not-found scopes) and the data surface's
// own hovers are button/select/input/summary-typed. A CSSOM probe
// with all five real stylesheets (1,336 rules) in the real ancestor
// contexts confirmed zero matching :hover rules and rest == hover.
// The links now take the data surface's established hover tint
// (#eaf3f7). The scope is tight in practice: the only .data-page
// roots are DataLanding (renders no <a>), DataPrep's opening branch
// (buttons only) and DatasetDetail. Background only, so the UA link
// colour/underline and resting geometry are unchanged; the data
// surface is fixed light, so no dark variant is added.
const css = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const rule = css.match(/^\.data-page a:hover\s*\{([^}]*)\}/m);

test('the data-page link hover rule exists and uses the data surface tint', () => {
  assert.ok(rule, 'expected the .data-page a:hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint is the established data-surface hover tint, distinct from the transparent rest', () => {
  assert.ok(css.match(/\.data-page button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page button hover must remain #eaf3f7');
  assert.ok(css.match(/\.data-menu > summary:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the slice-85 data-menu summary hover must remain #eaf3f7');
  assert.ok(css.match(/\.data-row-menu summary:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the slice-50 row-menu summary hover must remain #eaf3f7');
  assert.notEqual('#eaf3f7', 'transparent', 'the hover tint must differ from the resting state');
});

test('the link hover rule is paint-only: resting geometry and link presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:|text-decoration/.test(rule[1]), 'hover must change background only');
});

test('the resting data-page rules are preserved', () => {
  assert.ok(css.match(/\.data-breadcrumb\s*\{[^}]*display:\s*flex; gap:\s*8px/), 'the data-breadcrumb layout rule must remain');
  assert.ok(css.match(/\.data-page button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page button hover must remain');
  assert.ok(css.match(/\.data-menu-items button:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the data-menu-items button hover must remain #eaf3f7');
});

test('the neighbouring summary hover rules are untouched', () => {
  assert.ok(css.match(/\.data-summary-cards details > summary:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the slice-81 storage-settings summary hover must remain #eaf3f7');
  assert.ok(css.match(/\.data-split > \.data-menu > summary:hover\s*\{[^}]*background:\s*#145d76/), 'the slice-16 split summary hover must remain #145d76');
});

describe('Data-detail link hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry in every DatasetDetail link context, and links outside .data-page are out of scope', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<section class="data-page data-detail"><nav class="data-breadcrumb"><a id="crumb" href="#">Datasets</a><span>›</span><span>Sales</span></nav>`
      + `<a id="back" href="#">‹ Datasets</a>`
      + `<table class="data-table"><tbody><tr><td><a id="usage" href="#">My analysis</a></td></tr></tbody></table></section>`
      + `<div class="data-dialog"><a id="outside" href="#">Outside</a></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.data-page a:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, decoration: getComputedStyle(el).textDecorationLine, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, decoration: getComputedStyle(el).textDecorationLine, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const outside = document.querySelector('#outside');
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        crumb: found ? measure(document.querySelector('#crumb'), found) : null,
        back: found ? measure(document.querySelector('#back'), found) : null,
        usage: found ? measure(document.querySelector('#usage'), found) : null,
        outsideMatches: found ? outside.matches(found.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    for (const key of ['crumb', 'back', 'usage']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} link rest`);
      assert.equal(actual[key].hovered.background, 'rgb(234, 243, 247)', `${key} link hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, 'rgb(0, 0, 238)', `${key} link keeps the UA link colour at rest`);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} link colour unchanged on hover`);
      assert.equal(actual[key].rest.decoration, 'underline', `${key} link keeps its underline at rest`);
      assert.equal(actual[key].rest.decoration, actual[key].hovered.decoration, `${key} link underline unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} link geometry`);
    }
    assert.equal(actual.outsideMatches, false, 'a link inside .data-dialog (not .data-page) must be out of scope');
  });
});
