import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 128: hover feedback for the dataset execution
// controls' labels (.execution-controls label in DatasetExecution.tsx —
// "Execution mode" wrapping the mode select in every context, plus
// "Refresh interval (minutes)" wrapping the interval input in the
// non-compact form). Backup lead from slice 124, carried through slices
// 125–127 and re-verified this run: every label :hover rule in the
// cascade is scoped elsewhere — the prep label hovers cover the
// document bar, columns, step editor, input config and staging scopes
// but not the execution details, the data-dialog label hover does not
// reach the data-detail page, and the author label hovers cover the
// parameter/property/rename panels but not the dataset header — so the
// labels rested transparent in all four real contexts (data-detail,
// data-prep, author light chrome, author dark chrome) and hovering
// their text or gap changed nothing, while the field inside each label
// tinted. A CSSOM probe with all five real stylesheets (1,399 rules) in
// the real ancestor contexts confirmed zero matching :hover rules and
// a transparent rest for every label, while the inner select matched
// the data-page / data-prep / author select hovers and the interval
// input matched the data-prep input hover. The resting rule
// (.execution-controls label { display: grid; gap: 5px; }) makes each
// label a visible surface (text line, gap, field). Each label now
// takes the hover tint of the field inside it on its own surface, so
// no new colour is introduced and label and field read as one surface:
// #eaf3f7 on the data surfaces (the data-page select hover), #edf6fc
// in data-prep (its select/input hovers), #edf7f7 in author light
// chrome and #334c62 in author dark chrome (the author select hovers).
// Background only, so resting geometry is identical and there is no
// animation.
const styleCss = styles['style.css'];
const dataSectionCss = styles['data-section.css'];

const baseRule = styleCss.match(/^\.execution-controls label:hover\s*\{([^}]*)\}/m);
const prepRule = styleCss.match(/^\.data-prep \.execution-controls label:hover\s*\{([^}]*)\}/m);
const authorRule = styleCss.match(/^\.author-workspace \.execution-controls label:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.execution-controls label:hover\s*\{([^}]*)\}/m);

test('the execution-controls label hover rules exist for every surface and use each surface field tint', () => {
  assert.ok(baseRule, 'expected the base execution-controls label :hover rule');
  assert.match(baseRule[1], /background:\s*#eaf3f7/);
  assert.ok(prepRule, 'expected the data-prep execution-controls label hover variant');
  assert.match(prepRule[1], /background:\s*#edf6fc/);
  assert.ok(authorRule, 'expected the author execution-controls label hover variant');
  assert.match(authorRule[1], /background:\s*#edf7f7/);
  assert.ok(darkRule, 'expected the author dark-chrome execution-controls label hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the hover tints match the hovers of the fields inside the labels, so no new colour is introduced', () => {
  assert.ok(dataSectionCss.match(/\.data-page select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page select hover must remain #eaf3f7');
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep select hover must remain #edf6fc');
  assert.ok(styleCss.match(/\.data-prep input:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#edf6fc/), 'the data-prep input hover must remain #edf6fc');
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark select hover must remain #334c62');
});

test('the execution-controls label hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  for (const [name, rule] of [['base', baseRule], ['data-prep', prepRule], ['author', authorRule], ['dark', darkRule]]) {
    assert.ok(rule, `expected the ${name} execution-controls label :hover rule`);
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), `${name} hover must change background only`);
  }
});

test('the resting execution-controls rules are preserved', () => {
  assert.ok(styleCss.match(/\.execution-controls label\s*\{[^}]*display:\s*grid[^}]*gap:\s*5px/), 'the resting execution-controls label rule must remain');
  assert.ok(styleCss.match(/\.execution-controls input, \.execution-controls select\s*\{[^}]*padding:\s*7px 9px/), 'the resting execution-controls field rule must remain');
  assert.ok(styleCss.match(/\.prep-execution summary:hover\s*\{[^}]*background:\s*#edf6fc/), 'the prep-execution summary hover must remain');
});

defineHoverCases('execution-controls-label hover', {
  html: `<div class="app-shell"><main><section class="data-page data-detail"><div class="data-summary"><aside class="data-summary-cards"><section class="data-card"><details open><summary>Storage settings</summary><section class="dataset-execution compact"><div class="execution-controls"><label id="ddLabel">Execution mode<select><option>DIRECT QUERY</option></select></label></div></section></details></section></aside></div></section></main></div>`
      + `<main><section class="data-prep"><details class="prep-execution" open><summary>Dataset execution</summary><section class="dataset-execution"><div class="execution-controls"><label id="prepModeLabel">Execution mode<select><option>DIRECT QUERY</option></select></label><form><label id="prepIntervalLabel">Refresh interval (minutes)<input type="number"></label></form></div></section></details></section></main>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-layout"><section class="dataset-header"><section class="dataset-execution compact"><div class="execution-controls"><label id="authLabel">Execution mode<select><option>DIRECT QUERY</option></select></label></div></section></section></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout"><section class="dataset-header"><section class="dataset-execution compact"><div class="execution-controls"><label id="darkLabel">Execution mode<select><option>DIRECT QUERY</option></select></label></div></section></section></div></div>`
      + `<main><section class="dataset-execution"><label id="outsideLabel">Other<select><option>x</option></select></label></section></main>`,
  cases: [
    {
      target: '#ddLabel',
      rule: '.execution-controls label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel'],
    },
    {
      target: '#prepModeLabel',
      rule: '.data-prep .execution-controls label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 246, 252)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#prepIntervalLabel',
      rule: '.data-prep .execution-controls label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 246, 252)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#authLabel',
      rule: '.author-workspace .execution-controls label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#darkLabel',
      rule: '.author-workspace[data-chrome="dark"] .execution-controls label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
