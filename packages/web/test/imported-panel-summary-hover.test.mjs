import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 82: hover feedback for the ImportedPanels
// disclosure summaries (details.imported-panel in Author.tsx — the
// "Imported calculated fields" / "Imported filter groups" group
// summaries in the author Data panel, plus the nested per-value
// summaries inside them). Every author summary hover is scoped
// elsewhere — the builder-panel/field-group/property-section/
// parameter-editor/local-drafts hovers take direct-child summaries
// only, and the bundle-import hover takes summaries inside
// .bundle-import — so the imported-panel summary, a descendant (not
// direct child) of the Data builder-panel, matched none of them; its
// only rules are its cursor/margin rule and the global :active
// press. A CSSOM probe with the real stylesheets confirmed zero
// matching :hover rules for both the outer and the nested summaries.
// ImportedPanels renders only for imported bundles, so route audits
// never hover it (the slices 50/62/64/67/68 blind spot). It now
// takes the author surface's established hover tint (#edf7f7), so no
// new colour is introduced; the descendant selector covers the
// nested summaries too, mirroring .bundle-import summary:hover.
// Background only, so resting geometry is identical and there is no
// animation; the dark-chrome variant takes #334c62, the dark
// summary hover of the neighbouring panels.
const css = styles['style.css'];

const rule = css.match(/\.imported-panel summary:hover\s*\{([^}]*)\}/);
const darkRule = css.match(/\.author-workspace\[data-chrome=dark\] \.imported-panel summary:hover\s*\{([^}]*)\}/);

test('the imported-panel summary hover rule exists and uses the author surface tint', () => {
  assert.ok(rule, 'expected the .imported-panel summary:hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint is the established author hover tint, distinct from the transparent rest', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author generic button hover must remain #edf7f7');
  assert.ok(css.match(/\.author-workspace \.builder-panel > summary:hover[^{]*\{[^}]*background:\s*#edf7f7/), 'the builder-panel summary hover must remain #edf7f7');
  assert.notEqual('#edf7f7', 'transparent', 'the hover tint must differ from the resting state');
});

test('the dark-chrome variant uses the established dark summary hover tint', () => {
  assert.ok(darkRule, 'expected the dark-chrome imported-panel summary hover rule');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(css.match(/\.author-workspace\[data-chrome=dark\] \.builder-panel > summary:hover[^{]*\{[^}]*background:\s*#334c62/), 'the dark builder-panel summary hover must remain #334c62');
});

test('the summary hover rules are paint-only: resting geometry cannot shift', () => {
  assert.ok(rule && darkRule, 'expected both hover rules');
  for (const r of [rule, darkRule]) assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
});

test('the resting imported-panel rules are preserved', () => {
  assert.ok(css.match(/\.imported-panel\s*\{[^}]*border-top:\s*1px solid #d4e1e5/), 'the imported-panel layout rule must remain');
  assert.ok(css.match(/\.imported-panel pre\s*\{[^}]*white-space:\s*pre-wrap/), 'the imported-panel pre rule must remain');
  assert.ok(css.match(/\.imported-panel summary\s*\{[^}]*cursor:\s*pointer; margin:\s*6px 0/), 'the imported-panel summary resting rule must remain');
});

test('the neighbouring author summary hover rules are untouched', () => {
  assert.ok(css.match(/\.author-workspace \.bundle-import summary:hover\s*\{/), 'the bundle-import summary hover must remain in the shared summary hover group');
  assert.ok(css.match(/\.calculation-dialog \.o-build-for-me summary:hover\s*\{[^}]*background:\s*#edf7f7/), 'the slice-68 build-for-me summary hover must remain #edf7f7');
  assert.ok(css.match(/\.first-run summary:hover\s*\{[^}]*background:\s*#eaf3f4/), 'the first-run summary hover must remain #eaf3f4');
});

defineHoverCases('imported-panel-summary hover', {
  html: `<div class="author-workspace" data-chrome="light"><div class="author-layout">`
      + `<details class="builder-panel fields-panel" open><summary id="panel">Data</summary><div class="panel-content">`
      + `<details class="imported-panel" open><summary id="outer">Imported calculated fields</summary>`
      + `<details open><summary id="inner">Calc 1</summary><pre>{}</pre></details>`
      + `</details></div></details></div></div>`
      + `<details><summary id="outside">Outside summary</summary></details>`,
  cases: [
    {
      target: '#outer',
      rule: '.imported-panel summary:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      excluded: ['#panel', '#outside'],
    },
    {
      target: '#inner',
      rule: '.imported-panel summary:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
    },
  ],
});
