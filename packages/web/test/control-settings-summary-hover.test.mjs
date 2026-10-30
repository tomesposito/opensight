import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 83: hover feedback for the ControlsStrip
// per-control disclosure summary (.control-settings summary in
// ControlsStrip.tsx — "Edit {label}" above the sheet, one per
// parameter control). Every summary:hover rule in the cascade is
// scoped elsewhere — the builder-panel/field-group/property-section/
// parameter-editor/local-drafts hovers take direct-child summaries
// only, and the bundle-import/imported-panel/card-footer/first-run/
// prep hovers take summaries inside their own containers — so this
// summary, inside a plain details in a .control-container, matched
// none of them; its only rules are its font-size/margin rule and the
// global :active press, while the Move/Remove buttons inside the
// same details do tint via the author generic button hover. A CSSOM
// probe with the real stylesheet in the real ancestor context
// confirmed zero matching :hover rules and a transparent rest. The
// summary renders only when a sheet has parameter controls, so route
// audits without controls never hover it (the slices 50/62/64/67/68
// blind spot). It now takes the author surface's established hover
// tint (#eef3fd), so no new colour is introduced; the dark-chrome
// variant takes #36486a, the dark summary hover of the neighbouring
// panels. Background only, so resting geometry is identical and
// there is no animation.
const css = styles['style.css'];

const rule = css.match(/\.control-settings summary:hover\s*\{([^}]*)\}/);
const darkRule = css.match(/\.author-workspace\[data-chrome=dark\] \.control-settings summary:hover\s*\{([^}]*)\}/);

test('the control-settings summary hover rule exists and uses the author surface tint', () => {
  assert.ok(rule, 'expected the .control-settings summary:hover rule');
  assert.match(rule[1], /background:\s*#eef3fd/);
});

test('the hover tint is the established author hover tint, distinct from the transparent rest', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the author generic button hover must remain #eef3fd');
  assert.ok(css.match(/\.author-workspace \.builder-panel > summary:hover[^{]*\{[^}]*background:\s*#eef3fd/), 'the builder-panel summary hover must remain #eef3fd');
  assert.notEqual('#eef3fd', 'transparent', 'the hover tint must differ from the resting state');
});

test('the dark-chrome variant uses the established dark summary hover tint', () => {
  assert.ok(darkRule, 'expected the dark-chrome control-settings summary hover rule');
  assert.match(darkRule[1], /background:\s*#36486a/);
  assert.ok(css.match(/\.author-workspace\[data-chrome=dark\] \.builder-panel > summary:hover[^{]*\{[^}]*background:\s*#36486a/), 'the dark builder-panel summary hover must remain #36486a');
});

test('the summary hover rules are paint-only: resting geometry cannot shift', () => {
  assert.ok(rule && darkRule, 'expected both hover rules');
  for (const r of [rule, darkRule]) assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
});

test('the resting control-settings rules are preserved', () => {
  assert.ok(css.match(/\.control-settings\s*\{[^}]*font-size:\s*12px; margin-top:\s*8px/), 'the control-settings layout rule must remain');
  assert.ok(css.match(/\.controls-strip\s*\{[^}]*border:\s*1px solid/), 'the controls-strip rule must remain');
  assert.ok(css.match(/\.control-settings label\s*\{|parameter-control label, \.control-settings label/), 'the control-settings label rule must remain');
});

test('the neighbouring summary hover rules are untouched', () => {
  assert.ok(css.match(/\.imported-panel summary:hover\s*\{[^}]*background:\s*#eef3fd/), 'the slice-82 imported-panel summary hover must remain #eef3fd');
  assert.ok(css.match(/\.author-workspace \.bundle-import summary:hover\s*\{/), 'the bundle-import summary hover must remain in the shared summary hover group');
  assert.ok(css.match(/\.prep-execution summary:hover\s*\{[^}]*background:\s*#e8eefb/), 'the prep-execution summary hover must remain #e8eefb');
});

defineHoverCases('control-settings-summary hover', {
  html: `<div class="author-workspace" data-chrome="light"><div class="author-center">`
      + `<section class="controls-strip"><div class="controls-row"><div class="control-container">`
      + `<details class="control-settings" open><summary id="target">Edit Region</summary></details>`
      + `</div></div></section>`
      + `<details class="builder-panel" open><summary id="panel">Data</summary></details>`
      + `</div></div>`
      + `<details><summary id="outside">Outside summary</summary></details>`,
  cases: [
    {
      target: '#target',
      rule: '.control-settings summary:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      excluded: ['#panel', '#outside'],
    },
  ],
});
