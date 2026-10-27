import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 122: hover feedback for the API picker
// form's labels (.api-picker label — "Resource" and "Resource ID" in
// Application.tsx's ApiExplorer form, "Analysis dataset" in
// Author.tsx's dataset chooser). The resting rule (.api-picker label
// { display: flex; flex-direction: column; gap: 8px; }) makes each
// label a visible surface (text line, 8px gap, field), but the labels
// had zero hover feedback: slice 57 hovered the picker's fields and
// its submit button, but every label :hover rule in the cascade is
// scoped elsewhere (property-section, parameter-editor, control-form,
// calculation/analysis-file/data dialogs, prep labels,
// connector/sign-in/collection labels, admin labels, embed labels,
// the action panel body), so the labels rested transparent and
// hovering their text or gap changed nothing, while only the field
// inside each label tinted. A CSSOM probe with all five real
// stylesheets (1,389 rules) in the real ancestor contexts (the
// standalone form.api-picker, and .api-picker inside
// .author-workspace in light and dark chrome) confirmed zero
// matching :hover rules for the labels in all three contexts and a
// transparent rest, while the inner select/input matched the
// slice-57 field hover (plus the author field hovers in the Author
// contexts) and the submit matched the slice-57 button hover. The
// labels now take #edf7f7, the picker's own established hover tint
// (its slice-57 field hover and the author field/button/label
// hovers), plus the author dark-chrome variant #334c62 for the
// Author instance, so no new colour is introduced — and because the
// label and the field inside it take the same tint, hovering either
// reads as one surface, not two steps. Background only, so resting
// geometry is identical and there is no animation.
const styleCss = styles['style.css'];

const labelRule = styleCss.match(/^\.api-picker label:hover\s*\{([^}]*)\}/m);
const labelDarkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.api-picker label:hover\s*\{([^}]*)\}/m);

test('the api-picker label hover rules exist and use the established hover tints', () => {
  assert.ok(labelRule, 'expected the api-picker label :hover rule');
  assert.match(labelRule[1], /background:\s*#edf7f7/);
  assert.ok(labelDarkRule, 'expected the author dark-chrome api-picker label :hover variant');
  assert.match(labelDarkRule[1], /background:\s*#334c62/);
});

test('the hover tints match the slice-57 api-picker field hover and the author dark field hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.api-picker select:hover:not\(:disabled\),\s*\.api-picker input:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-57 api-picker field hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark field hover must remain #334c62');
  assert.ok(styleCss.match(/\.api-picker button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#126e76/), 'the slice-57 api-picker button hover must remain #126e76');
});

test('the api-picker label hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  for (const r of [labelRule, labelDarkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting api-picker rules are preserved', () => {
  assert.ok(styleCss.match(/\.api-picker\s*\{[^}]*display:\s*flex/), 'the resting api-picker rule must remain');
  assert.ok(styleCss.match(/\.api-picker label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*8px/), 'the resting api-picker label rule must remain');
  assert.ok(styleCss.match(/\.api-picker button\s*\{[^}]*background:\s*#157f88/), 'the resting api-picker button rule must remain');
});

defineHoverCases('api-picker-label hover', {
  html: `<form class="api-picker"><label id="soloLabel">Resource<select id="soloSelect"><option>Analysis</option></select></label></form>`
      + `<div class="author-workspace"><div class="api-picker"><label id="authorLabel">Analysis dataset<select><option>Sample</option></select></label></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="api-picker"><label id="darkLabel">Analysis dataset<select><option>Sample</option></select></label></div></div>`
      + `<form><label id="outsideLabel">Outside<input/></label></form>`,
  cases: [
    {
      target: '#soloLabel',
      rule: '.api-picker label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel'],
    },
    {
      target: '#authorLabel',
      rule: '.api-picker label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#darkLabel',
      rule: '.author-workspace[data-chrome="dark"] .api-picker label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel'],
    },
  ],
});
