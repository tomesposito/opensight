import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 134: hover feedback for the Data panel's
// "Search fields" label (.fields-panel .panel-content > label in
// Author.tsx — the text line plus its search input at the top of the
// author Data panel). The shared .author-layout label rule lays the
// label out as a column flex (text line, 4px gap, field), so the label
// is itself a visible surface, but the label had zero hover feedback:
// every label :hover rule in the cascade is scoped elsewhere
// (property sections, panels, dialogs, the data-prep series, the
// embed/admin/connector scopes), so the label rested transparent and
// hovering its text or gap changed nothing, while only the input
// inside it tinted via the author-layout input hover. A CSSOM probe
// with all five real stylesheets (1,408 rules) in the real ancestor
// context (.author-workspace[data-chrome] > .author-layout >
// details.builder-panel.fields-panel > .panel-content) confirmed zero
// matching :hover rules for the label and a transparent rest in both
// chromes, while the inner input matched the author-layout input
// hover. The label now takes the input's own hover tint (#eef3fd;
// dark chrome #36486a — the fixture-picker / chrome-switch precedent:
// the label takes its field's hover tint), so no new colour is
// introduced and label and field read as one surface. The scope is
// the direct child of .panel-content, so the dataset header's
// execution-controls labels nested in their section keep their own
// slice-128 rules (the same tints) and the field-group rows are out
// of scope. Background only, so resting geometry is identical and
// there is no animation.
const styleCss = styles['style.css'];

const labelRule = styleCss.match(/^\.fields-panel \.panel-content > label:hover\s*\{([^}]*)\}/m);
const darkLabelRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.fields-panel \.panel-content > label:hover\s*\{([^}]*)\}/m);

test('the search-fields label hover rules exist and use the established author tints', () => {
  assert.ok(labelRule, 'expected the .fields-panel .panel-content > label:hover rule');
  assert.match(labelRule[1], /background:\s*#eef3fd/);
  assert.ok(darkLabelRule, 'expected the dark-chrome search-fields label :hover variant');
  assert.match(darkLabelRule[1], /background:\s*#36486a/);
});

test('the hover tints match the author-layout input hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/^\.author-layout input:hover[^{]*\{[^}]*background:\s*#eef3fd/m), 'the author-layout input hover must remain #eef3fd');
  assert.ok(styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.author-layout input:hover[^{]*\{[^}]*background:\s*#36486a/m), 'the dark author-layout input hover must remain #36486a');
});

test('the label hover rules are paint-only: resting geometry and text colour cannot shift', () => {
  for (const rule of [labelRule, darkLabelRule]) {
    assert.ok(rule, 'expected both search-fields label :hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the resting author-layout label rule and the fields-panel structure rules are preserved', () => {
  assert.ok(styleCss.match(/\.author-layout label, \.analysis-title, \.rename-sheet label, \.calculation-dialog label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*4px/), 'the shared resting author-layout label rule must remain');
  assert.ok(styleCss.match(/\.author-layout:has\(> \.fields-panel:not\(\[open\]\)\)\s*\{[^}]*--data-width:\s*44px/), 'the collapsed fields-panel width rule must remain');
});

const panel = (id, extra = '') => `<details class="builder-panel fields-panel" open><summary>Data</summary><div class="panel-content"><section class="dataset-header"><div class="execution-controls"><label id="${id}Nested">Execution mode<select><option>BLAZE</option></select></label></div></section><label id="${id}">Search fields<input id="${id}Input" type="search"/></label>${extra}</div></details>`;

defineHoverCases('search-fields-label hover', {
  html: `<div class="author-workspace" data-chrome="light"><div class="author-layout">${panel('light')}</div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout">${panel('dark')}</div></div>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-layout"><details class="builder-panel build-panel" open><summary>Build</summary><div class="panel-content"><label id="otherPanel">Other<input/></label></div></details></div></div>`,
  cases: [
    {
      target: '#light',
      rule: '.fields-panel .panel-content > label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#lightNested', '#otherPanel'],
    },
    {
      target: '#dark',
      rule: '.author-workspace[data-chrome="dark"] .fields-panel .panel-content > label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(54, 72, 106)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lightInput',
      rule: '.author-layout input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="range"]), .author-layout textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
