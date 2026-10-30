import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 final audit: hover feedback for the bundle-import label
// (.author-workspace .bundle-import label in Author.tsx — the flex row
// "Import .qs or bundle JSON" wrapping the bundle file input). The
// exhaustive final audit (static extraction of every interactive
// element in packages/web/src, contexts resolved through the component
// graph, computed style at rest vs hover in Chromium with all five
// shipped stylesheets) found it was the author surface's last label
// with zero hover feedback: its sibling summary takes the author
// summary hover (.bundle-import summary:hover), the file input inside
// it is a native OS-rendered control (out of scope by design), and
// every other label :hover rule in the cascade is scoped elsewhere
// (property-section, parameter-editor, prep, data-dialog, sign-in,
// collection labels). The label now takes the author label tint
// #eef3fd (dark #36486a) — the same tints as the property-section and
// parameter-editor label hovers — so the row reads as one surface with
// the field it labels. Background only, so resting geometry is
// identical and there is no animation.
const styleCss = styles['style.css'];

const lightRule = styleCss.match(/^\.author-workspace \.bundle-import label:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.bundle-import label:hover\s*\{([^}]*)\}/m);

test('the bundle-import label hover rule exists with the author label tint, light and dark', () => {
  assert.ok(lightRule, 'expected the bundle-import label :hover rule');
  assert.match(lightRule[1], /background:\s*#eef3fd/);
  assert.ok(darkRule, 'expected the dark bundle-import label :hover rule');
  assert.match(darkRule[1], /background:\s*#36486a/);
});

test('the hover tint matches the neighbouring author label hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.property-section label:hover\s*\{[^}]*background:\s*#eef3fd/), 'the property-section label hover must remain #eef3fd');
  assert.ok(styleCss.match(/\.author-workspace \.bundle-import summary:hover/), 'the bundle-import summary hover must remain');
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [lightRule, darkRule]) {
    assert.ok(rule, 'expected both bundle-import label :hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the resting bundle-import rules are preserved', () => {
  assert.ok(styleCss.match(/\.bundle-import label\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/), 'the resting bundle-import label rule must remain');
  assert.ok(styleCss.match(/\.bundle-import\s*\{[^}]*border:\s*1px dashed/), 'the resting bundle-import box rule must remain');
});

defineHoverCases('bundle-import-label hover', {
  html: `<div class="author-workspace" data-chrome="light"><div class="author-tools"><div class="bundle-import"><details open><summary>Import bundle</summary>`
      + `<label id="lightLabel">Import .qs or bundle JSON<input type="file"/></label></details></div>`
      + `<label id="outsideLabel">Outside<input/></label></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-tools"><div class="bundle-import"><details open><summary>Import bundle</summary>`
      + `<label id="darkLabel">Import .qs or bundle JSON<input type="file"/></label></details></div></div></div>`,
  cases: [
    {
      target: '#lightLabel',
      rule: '.author-workspace .bundle-import label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      excluded: ['#outsideLabel'],
    },
    {
      target: '#darkLabel',
      rule: '.author-workspace[data-chrome="dark"] .bundle-import label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(54, 72, 106)' },
      paintOnly: true,
    },
  ],
});
