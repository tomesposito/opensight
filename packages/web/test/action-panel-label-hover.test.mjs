import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 121: hover feedback for the action panel's
// plain field labels (.action-panel-body label — "Action name" and
// "Action type" in ActionEditor.tsx's ActionPanel, "Source field" in
// FilterFields, "URL template" and "Open in" in UrlFields, "Target
// sheet", "Mapped source field" and "Target parameter" in
// NavigationFields). The resting rule (.action-panel-body label
// { display: grid; gap: 4px; }) makes each label a visible surface
// (text line, 4px gap, field), but the plain labels had zero hover
// feedback: every label :hover rule in the cascade is scoped
// elsewhere (property-section, parameter-editor, control-form,
// calculation/analysis-file/data dialogs, prep labels,
// connector/sign-in/collection labels, admin labels, embed labels),
// and the panel's own label hovers cover only its radio/checkbox
// labels via the :has rules, so the plain labels rested transparent
// and hovering their text or gap changed nothing, while only the
// field inside each label tinted via the author field hovers. A
// CSSOM probe with all five real stylesheets (1,387 rules) in the
// real ancestor context (author-workspace > author-layout >
// .action-panel > .action-panel-body) confirmed zero matching
// :hover rules for the plain labels and a transparent rest, while
// the radio/checkbox labels matched the :has hovers and the inner
// input/select matched the author field hovers. The labels now take
// #edf7f7, the author surface's established hover tint (the panel's
// own :has label hovers, the author field, button and summary
// hovers, and the slices 112-120 label hovers), plus the author
// dark-chrome variant #334c62, so no new colour is introduced — and
// because the label and the field inside it take the same tint,
// hovering either reads as one surface, not two steps. The :has
// rules carry higher specificity with the same tints, so the
// radio/checkbox labels are unchanged whichever rule wins.
// Background only, so resting geometry is identical and there is
// no animation.
const styleCss = styles['style.css'];

const labelRule = styleCss.match(/^\.action-panel-body label:hover\s*\{([^}]*)\}/m);
const labelDarkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.action-panel-body label:hover\s*\{([^}]*)\}/m);

test('the action-panel label hover rules exist and use the established hover tints', () => {
  assert.ok(labelRule, 'expected the action-panel-body label :hover rule');
  assert.match(labelRule[1], /background:\s*#edf7f7/);
  assert.ok(labelDarkRule, 'expected the author dark-chrome action-panel-body label :hover variant');
  assert.match(labelDarkRule[1], /background:\s*#334c62/);
});

test('the hover tints match the panel :has label hovers and the author field hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.action-radio-group label:has\(> input\[type=radio\]\):hover\s*\{[^}]*background:\s*#edf7f7/), 'the panel radio label hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.action-checkbox-list label:has\(> input\[type=checkbox\]\):hover\s*\{[^}]*background:\s*#edf7f7/), 'the panel checkbox label hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-layout input:hover:not\(:disabled\):not\(\[type=radio\]\)[^{]*\{[^}]*background:\s*#edf7f7/), 'the author field hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.action-radio-group label:has\(> input\[type=radio\]\):hover\s*\{[^}]*background:\s*#334c62/), 'the dark panel radio label hover must remain #334c62');
});

test('the action-panel label hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  for (const r of [labelRule, labelDarkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting action-panel rules are preserved', () => {
  assert.ok(styleCss.match(/\.action-panel-body\s*\{[^}]*display:\s*grid/), 'the resting action-panel-body rule must remain');
  assert.ok(styleCss.match(/\.action-panel-body label\s*\{[^}]*display:\s*grid[^}]*gap:\s*4px/), 'the resting action-panel-body label rule must remain');
  assert.ok(styleCss.match(/\.action-radio-group label\s*\{[^}]*display:\s*flex/), 'the resting radio-group label rule must remain');
});

const ctx = (id, dark) => `<div class="author-workspace" ${dark ? 'data-chrome="dark"' : ''}><div class="author-layout"><div class="action-panel"><div class="action-panel-body">`
      + `<label id="${id}Label">Action name<input id="${id}Input"/></label>`
      + `<fieldset class="action-radio-group"><label id="${id}Radio"><input type="radio" checked/>Select</label></fieldset>`
      + `</div></div></div></div>`;

defineHoverCases('action-panel-label hover', {
  html: `` + ctx('l', false) + ctx('d', true)
      + `<div class="author-workspace"><div class="author-layout"><label id="outsideLabel">Outside<input/></label></div></div>`,
  cases: [
    {
      target: '#lLabel',
      rule: '.action-panel-body label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel'],
    },
    {
      target: '#dLabel',
      rule: '.author-workspace[data-chrome="dark"] .action-panel-body label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
