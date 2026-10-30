import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

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
// (#e8eefb). The scope is tight in practice: the only .data-page
// roots are DataLanding (renders no <a>), DataPrep's opening branch
// (buttons only) and DatasetDetail. Background only, so the UA link
// colour/underline and resting geometry are unchanged; the data
// surface is fixed light, so no dark variant is added.
const css = styles['data-section.css'];

const rule = css.match(/^\.data-page a:hover\s*\{([^}]*)\}/m);

test('the data-page link hover rule exists and uses the data surface tint', () => {
  assert.ok(rule, 'expected the .data-page a:hover rule');
  assert.match(rule[1], /background:\s*#e8eefb/);
});

test('the hover tint is the established data-surface hover tint, distinct from the transparent rest', () => {
  assert.ok(css.match(/\.data-page button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-page button hover must remain #e8eefb');
  assert.ok(css.match(/\.data-menu > summary:hover\s*\{[^}]*background:\s*#e8eefb/), 'the slice-85 data-menu summary hover must remain #e8eefb');
  assert.ok(css.match(/\.data-row-menu summary:hover\s*\{[^}]*background:\s*#e8eefb/), 'the slice-50 row-menu summary hover must remain #e8eefb');
  assert.notEqual('#e8eefb', 'transparent', 'the hover tint must differ from the resting state');
});

test('the link hover rule is paint-only: resting geometry and link presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:|text-decoration/.test(rule[1]), 'hover must change background only');
});

test('the resting data-page rules are preserved', () => {
  assert.ok(css.match(/\.data-breadcrumb\s*\{[^}]*display:\s*flex; gap:\s*8px/), 'the data-breadcrumb layout rule must remain');
  assert.ok(css.match(/\.data-page button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#e8eefb/), 'the data-page button hover must remain');
  assert.ok(css.match(/\.data-menu-items button:hover\s*\{[^}]*background:\s*#e8eefb/), 'the data-menu-items button hover must remain #e8eefb');
});

test('the neighbouring summary hover rules are untouched', () => {
  assert.ok(css.match(/\.data-summary-cards details > summary:hover\s*\{[^}]*background:\s*#e8eefb/), 'the slice-81 storage-settings summary hover must remain #e8eefb');
  assert.ok(css.match(/\.data-split > \.data-menu > summary:hover\s*\{[^}]*background:\s*#1e4fa3/), 'the slice-16 split summary hover must remain #1e4fa3');
});

defineHoverCases('data-detail-link hover', {
  html: `<section class="data-page data-detail"><nav class="data-breadcrumb"><a id="crumb" href="#">Datasets</a><span>›</span><span>Sales</span></nav>`
      + `<a id="back" href="#">‹ Datasets</a>`
      + `<table class="data-table"><tbody><tr><td><a id="usage" href="#">My analysis</a></td></tr></tbody></table></section>`
      + `<div class="data-dialog"><a id="outside" href="#">Outside</a></div>`,
  cases: [
    {
      target: '#crumb',
      rule: '.data-page a:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(0, 0, 238)', textDecorationLine: 'underline' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color', 'textDecorationLine'],
      excluded: ['#outside'],
    },
    {
      target: '#back',
      rule: '.data-page a:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(0, 0, 238)', textDecorationLine: 'underline' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color', 'textDecorationLine'],
    },
    {
      target: '#usage',
      rule: '.data-page a:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(0, 0, 238)', textDecorationLine: 'underline' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      unchanged: ['color', 'textDecorationLine'],
    },
  ],
});
