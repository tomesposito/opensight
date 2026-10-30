import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 101: hover feedback for the ActionEditor's
// radio labels (.action-radio-group label in ActionEditor.tsx — the
// Activation, Filter scope and Target visuals choices, all inside the
// .action-panel in the author Properties dock). They had zero hover
// feedback. Every :hover rule that reaches the panel is scoped
// elsewhere or excludes them — the author field hover reaches the
// panel's inputs and selects but deliberately excludes radio inputs
// so native controls keep their OS rendering, and no label hover rule
// reached .action-radio-group — so neither the labels nor their radios
// matched any :hover rule, while the fields and buttons around them
// do step. This is the radio variant of the slice-100 checkbox thread
// in the same panel, left as its backup lead. A CSSOM probe with all
// five real stylesheets in the real ancestor contexts (author light
// chrome and author dark chrome) confirmed zero matching :hover rules
// for the radio labels and a transparent rest in both. The labels now
// take #eef3fd, the author surface's established hover tint (the
// author button and field hovers), so no new colour is introduced.
// The rule is on the label, not the radio: the radio keeps its native
// rendering, following the slice-94 connector-toggle, slice-95
// sign-in-check, slice-96 favorites-filter, slice-97 toggle-label,
// slice-98 O-mode-label, slice-99 parameter-checkbox and slice-100
// action-checkbox precedents where the label surface hovers and its
// inner input does not. The :has(> input[type=radio]) scope — the
// slice-99/100 precedent — targets exactly the radio labels; the
// checkbox labels nested inside the same fieldsets (in
// .action-checkbox-list) stay out of scope because they are covered
// by slice 100. The dark-chrome variant takes the author dark hover
// tint (#36486a, the dark button and field hovers). Background only,
// so resting geometry is identical and there is no animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.action-radio-group label:has\(> input\[type=radio\]\):hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.action-radio-group label:has\(> input\[type=radio\]\):hover\s*\{([^}]*)\}/m);

test('the action radio label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .action-radio-group radio label :hover rule');
  assert.match(rule[1], /background:\s*#eef3fd/);
});

test('the hover tint matches the author button and field hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the author button hover must remain #eef3fd');
  assert.ok(styleCss.match(/\.author-layout input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\)/), 'the author field hover must remain and keep its radio exclusion');
});

test('the action radio label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting action-radio-group rules are preserved, the radio has no hover rule of its own, and the dark variant uses the author dark hover tint', () => {
  assert.ok(styleCss.match(/\.action-radio-group\s*\{[^}]*display:\s*grid/), 'the action-radio-group resting rule must remain');
  assert.ok(styleCss.match(/\.action-radio-group label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*row/), 'the action-radio-group label resting rule must remain');
  assert.ok(!/\.action-radio-group input:hover/.test(styleCss), 'the radio must keep its native rendering with no hover rule of its own');
  assert.ok(darkRule, 'expected the author dark-chrome action radio label hover variant');
  assert.match(darkRule[1], /background:\s*#36486a/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#36486a/), 'the author dark button hover must remain #36486a');
});

const panel = prefix => `<div class="action-panel"><div class="action-panel-body">`
      + `<fieldset class="action-radio-group"><legend>Activation</legend>`
      + `<label id="${prefix}Activation"><input id="${prefix}ActivationRadio" type="radio">Select</label></fieldset>`
      + `<fieldset class="action-radio-group"><legend>Filter scope</legend>`
      + `<label id="${prefix}Scope"><input type="radio">Selected fields</label>`
      + `<div class="action-checkbox-list"><label id="${prefix}Check"><input type="checkbox">region</label></div></fieldset>`
      + `<fieldset class="action-radio-group"><legend>Target visuals</legend>`
      + `<label id="${prefix}Target"><input type="radio">All visuals</label></fieldset>`
      + `</div></div>`;

defineHoverCases('action-radio hover', {
  html: `<div class="author-workspace"><div class="author-layout"><aside class="builder-panel"><div class="panel-content">${panel('lt')}</div></aside></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout"><aside class="builder-panel"><div class="panel-content">${panel('dk')}</div></aside></div></div>`
      + `<label id="outsideLabel"><input type="radio">Other label</label>`,
  cases: [
    {
      target: '#ltActivation',
      rule: '.action-radio-group label:has(> input[type="radio"]):hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#ltActivationRadio', '#ltCheck', '#outsideLabel'],
    },
    {
      target: '#ltScope',
      rule: '.action-radio-group label:has(> input[type="radio"]):hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#ltTarget',
      rule: '.action-radio-group label:has(> input[type="radio"]):hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dkTarget',
      rule: '.author-workspace[data-chrome="dark"] .action-radio-group label:has(> input[type="radio"]):hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(54, 72, 106)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
