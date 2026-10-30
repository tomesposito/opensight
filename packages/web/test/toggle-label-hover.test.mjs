import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 97: hover feedback for the Properties panels'
// toggle labels (label.toggle in Author.tsx / PropertiesSections.tsx /
// FormattingEditor.tsx / PivotOptionsEditor.tsx / TooltipEditor.tsx /
// SheetObjectCard.tsx — "Show legend", "Show totals", "Donut", "Hide
// empty rows", the filter-value labels, all inside .author-layout).
// They had zero hover feedback. Every :hover rule that reaches them is
// scoped elsewhere or excludes them — the author field hover
// deliberately excludes checkbox inputs so native controls keep their
// OS rendering, and the author button hover is button-typed — so
// neither the labels nor their checkboxes matched any :hover rule,
// while the buttons and fields around them do step. A CSSOM probe with
// all five real stylesheets (1,350 rules) in the real ancestor contexts
// (author light chrome and author dark chrome) confirmed zero matching
// :hover rules and a transparent rest in both. The label now takes
// #eef3fd, the author surface's established hover tint (the author
// button and field hovers), so no new colour is introduced. The rule is
// on the label, not the checkbox: the checkbox keeps its native
// rendering, following the slice-94 connector-toggle, slice-95
// sign-in-check and slice-96 favorites-filter precedents where the
// label surface hovers and its inner input does not. The selector is
// label.toggle, so the one div.toggle row in TooltipEditor (a span plus
// its Remove button, whose button already hovers via the author button
// hover) stays out of scope. The dark-chrome variant takes the author
// dark hover tint (#36486a, the dark button and field hovers).
// Background only, so resting geometry is identical and there is no
// animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^label\.toggle:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] label\.toggle:hover\s*\{([^}]*)\}/m);

test('the toggle label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the label.toggle :hover rule');
  assert.match(rule[1], /background:\s*#eef3fd/);
});

test('the hover tint matches the author button and select hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the author button hover must remain #eef3fd');
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the author select hover must remain #eef3fd');
});

test('the toggle label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting toggle rules are preserved, the checkbox has no hover rule of its own, and the dark variant uses the author dark hover tint', () => {
  assert.ok(styleCss.match(/\.author-layout \.toggle\s*\{[^}]*flex-direction:\s*row[^}]*margin:\s*6px 0/), 'the toggle resting rule must remain');
  assert.ok(styleCss.match(/\.toggle input\s*\{[^}]*accent-color:\s*#3b82f6/), 'the toggle input resting rule must remain');
  assert.ok(!/label\.toggle input:hover/.test(styleCss), 'the checkbox must keep its native rendering with no hover rule of its own');
  assert.ok(!/label\.toggle:hover[^{]*\{[^}]*input/.test(styleCss), 'the label hover rule must not target the checkbox');
  assert.ok(darkRule, 'expected the author dark-chrome toggle label hover variant');
  assert.match(darkRule[1], /background:\s*#36486a/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#36486a/), 'the author dark button hover must remain #36486a');
});

defineHoverCases('toggle-label hover', {
  html: `<div class="author-workspace"><div class="author-layout"><aside class="builder-panel properties-panel"><div class="panel-content">`
      + `<label class="toggle" id="toggleLabel"><input id="toggleBox" type="checkbox">Show legend</label>`
      + `<div class="toggle" id="toggleDiv"><span>Extra field</span></div>`
      + `</div></aside></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout"><aside class="builder-panel properties-panel"><div class="panel-content">`
      + `<label class="toggle" id="toggleDark"><input type="checkbox">Show legend</label></div></aside></div></div>`
      + `<label id="outsideLabel"><input type="checkbox">Other toggle</label>`,
  cases: [
    {
      target: '#toggleLabel',
      rule: 'label.toggle:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#toggleBox', '#toggleDiv', '#outsideLabel'],
    },
    {
      target: '#toggleDark',
      rule: '.author-workspace[data-chrome="dark"] label.toggle:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(54, 72, 106)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#toggleDark > input:nth-child(1)'],
    },
  ],
});
