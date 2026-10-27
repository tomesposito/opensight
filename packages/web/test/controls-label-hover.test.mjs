import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 112: hover feedback for the sheet
// controls strip's field labels (.parameter-control label — the
// on-sheet control's own label in ControlInput.tsx, wrapping its
// select, range slider or text/date input; .control-settings
// label — "Bound parameter" in the per-control Edit details in
// ControlsStrip.tsx; and .control-form label — the Add-control
// form's "Control label", "Parameter", "Control type", "Options
// source", "Options (one per line)", "Cascade from", "Parent
// filter column" and "Minimum" / "Maximum" / "Step"). The shared
// resting rule lays all three label types out as column flexes
// (text line, 4px gap, field), so each label is itself a visible
// surface, but the labels had zero hover feedback: every label
// :hover rule in the cascade is scoped elsewhere (author toggles,
// parameter/action editor labels, the O-mode notice label,
// connector/sign-in/collection labels, the data-prep label series,
// the change-type label, the admin labels, the embed labels), so
// the labels rested transparent and hovering their text or gap
// changed nothing, while only the field inside each label tinted
// via the author field hovers — and the slider's range input is
// deliberately excluded from the author field hover, so the
// slider label was fully dead on hover. A CSSOM probe with all
// five real stylesheets (1,371 rules) in the real ancestor
// contexts (author-workspace > author-layout > author-center >
// controls-strip, light and dark chrome) confirmed zero matching
// :hover rules for all eight label variants and a transparent
// rest in both chromes. This was the fresh zero-hover audit on a
// new surface left by slice 111. The labels now take #edf7f7, the
// author surface's established hover tint (the author button,
// field and summary hovers, and the slice-83 control-settings
// summary hover in this same strip), plus the author dark-chrome
// variant #334c62, so no new colour is introduced — and because
// the inner field's own hover is the same tint, hovering the
// field inside the label reads as one surface, not two steps.
// Background only, so resting geometry is identical and there is
// no animation. The .parameter-editor plain labels share the
// resting rule but stay out of scope: they are a different surface
// (the Data panel), and their checkbox labels are slice 99.
const styleCss = styles['style.css'];

const rule = styleCss.match(/\.parameter-control label:hover,\s*\.control-settings label:hover,\s*\.control-form label:hover\s*\{([^}]*)\}/);
const darkRule = styleCss.match(/\.author-workspace\[data-chrome=dark\] \.parameter-control label:hover,\s*\.author-workspace\[data-chrome=dark\] \.control-settings label:hover,\s*\.author-workspace\[data-chrome=dark\] \.control-form label:hover\s*\{([^}]*)\}/);

test('the controls label hover rule exists for all three controls label contexts and uses the established hover tint', () => {
  assert.ok(rule, 'expected the grouped controls label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tints match the author field/button hovers and the slice-83 summary hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.control-settings summary:hover\s*\{[^}]*background:\s*#edf7f7/), 'the slice-83 control-settings summary hover must remain #edf7f7');
  assert.ok(darkRule, 'expected the author dark-chrome controls label :hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.control-settings summary:hover\s*\{[^}]*background:\s*#334c62/), 'the slice-83 dark summary hover must remain #334c62');
});

test('the controls label hover rules are paint-only: resting geometry and label presentation cannot shift', () => {
  for (const r of [rule, darkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting controls label rule is preserved and the parameter-editor labels stay out of this slice\u2019s scope', () => {
  assert.ok(styleCss.match(/\.parameter-control label, \.control-settings label, \.control-form label, \.parameter-editor label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*4px[^}]*margin-bottom:\s*8px/), 'the shared resting label rule must remain');
  // The parameter-editor plain labels were out of scope for slices
  // 112/113 (a different surface, the Data panel); slice 115 later
  // covered them with their own rule at the same author tint, which
  // parameter-editor-label-hover.test.mjs now guards. This slice's
  // grouped rule must still not reach them.
  assert.ok(!rule[0].includes('parameter-editor'), 'the controls label hover rule must not cover the parameter-editor labels');
});

const strip = (id, dark) => `<div class="author-workspace" ${dark ? 'data-chrome="dark"' : ''}><div class="author-layout"><div class="author-center">`
      + `<section class="controls-strip"><div class="controls-row"><div class="control-container">`
      + `<div class="parameter-control"><label id="${id}Pc">Region<select><option>a</option></select></label></div>`
      + `<div class="parameter-control"><label id="${id}Slider">Amount<input type="range" min="0" max="10"/><output>5</output></label></div>`
      + `<details class="control-settings" open><summary>Edit Region</summary><label id="${id}Cs">Bound parameter<select><option>p</option></select></label></details>`
      + `</div></div>`
      + `<form class="control-form"><label id="${id}Cf">Control label<input value="x"/></label></form>`
      + `</section></div></div></div>`;

defineHoverCases('controls-label hover', {
  html: `` + strip('l', false) + strip('d', true)
      + `<div class="author-workspace"><details class="parameter-editor" open><summary>Parameters</summary><form><label id="peLabel">Parameter name<input value="y"/></label></form></details></div>`
      + `<label id="outsideLabel">Outside<input/></label>`,
  cases: [
    {
      target: '#lPc',
      rule: '.parameter-control label:hover, .control-settings label:hover, .control-form label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#peLabel', '#outsideLabel'],
    },
    {
      target: '#lSlider',
      rule: '.parameter-control label:hover, .control-settings label:hover, .control-form label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lCs',
      rule: '.parameter-control label:hover, .control-settings label:hover, .control-form label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lCf',
      rule: '.parameter-control label:hover, .control-settings label:hover, .control-form label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dPc',
      rule: '.author-workspace[data-chrome="dark"] .parameter-control label:hover, .author-workspace[data-chrome="dark"] .control-settings label:hover, .author-workspace[data-chrome="dark"] .control-form label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dSlider',
      rule: '.author-workspace[data-chrome="dark"] .parameter-control label:hover, .author-workspace[data-chrome="dark"] .control-settings label:hover, .author-workspace[data-chrome="dark"] .control-form label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dCs',
      rule: '.author-workspace[data-chrome="dark"] .parameter-control label:hover, .author-workspace[data-chrome="dark"] .control-settings label:hover, .author-workspace[data-chrome="dark"] .control-form label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dCf',
      rule: '.author-workspace[data-chrome="dark"] .parameter-control label:hover, .author-workspace[data-chrome="dark"] .control-settings label:hover, .author-workspace[data-chrome="dark"] .control-form label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
