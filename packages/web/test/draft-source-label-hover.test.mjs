import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 123: hover feedback for the draft-source
// recovery banner's label (.draft-source-recovery label —
// "Replacement dataset" in DraftSource.tsx's DraftSourceRecovery
// aside, rendered as a direct child of .author-workspace in
// Author.tsx when a saved draft's source data is unavailable). The
// label had zero hover feedback: the author select hover (slice 36)
// and the author button hover reach the controls inside the banner,
// but every label :hover rule in the cascade is scoped elsewhere
// (property-section, parameter-editor, control-form,
// calculation/analysis-file/data dialogs, prep labels,
// connector/sign-in/collection labels, admin labels, embed labels,
// the action panel body, the api picker), so the label rested
// transparent and hovering its text changed nothing, while only the
// select inside it tinted. A CSSOM probe with all five real
// stylesheets (1,391 rules) in the real ancestor contexts
// (.author-workspace in light and dark chrome >
// aside.draft-source-recovery > label) confirmed zero matching
// :hover rules for the label in both chromes and a transparent rest,
// while the inner select matched the author select hovers and the
// banner's buttons matched the author button hover. The label now
// takes #eef3fd, the author surface's established hover tint (its
// select/button/field/label hovers), plus the author dark-chrome
// variant #36486a, so no new colour is introduced — and because the
// label and the select inside it take the same tint, hovering either
// reads as one surface, not two steps. Background only, so resting
// geometry is identical and there is no animation.
const styleCss = styles['style.css'];

const labelRule = styleCss.match(/^\.draft-source-recovery label:hover\s*\{([^}]*)\}/m);
const labelDarkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.draft-source-recovery label:hover\s*\{([^}]*)\}/m);

test('the draft-source label hover rules exist and use the established hover tints', () => {
  assert.ok(labelRule, 'expected the draft-source-recovery label :hover rule');
  assert.match(labelRule[1], /background:\s*#eef3fd/);
  assert.ok(labelDarkRule, 'expected the author dark-chrome draft-source label :hover variant');
  assert.match(labelDarkRule[1], /background:\s*#36486a/);
});

test('the hover tints match the author select hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the author select hover must remain #eef3fd');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#36486a/), 'the author dark select hover must remain #36486a');
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\),\s*\.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the author button hover must remain #eef3fd');
});

test('the draft-source label hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  for (const r of [labelRule, labelDarkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting draft-source-recovery rules are preserved', () => {
  assert.ok(styleCss.match(/\.draft-source-recovery\s*\{[^}]*background:\s*#fff8e6/), 'the resting banner rule must remain');
  assert.ok(styleCss.match(/\.draft-source-recovery button,\s*\.draft-source-recovery label\s*\{[^}]*margin:\s*4px 8px 4px 0/), 'the resting banner control margin rule must remain');
  assert.ok(styleCss.match(/\.draft-source-recovery select\s*\{[^}]*max-width:\s*100%/), 'the resting banner select rule must remain');
});

defineHoverCases('draft-source-label hover', {
  html: `<div class="author-workspace"><aside class="draft-source-recovery"><label id="lightLabel">Replacement dataset<select><option>Choose a compatible dataset…</option></select></label></aside></div>`
      + `<div class="author-workspace" data-chrome="dark"><aside class="draft-source-recovery"><label id="darkLabel">Replacement dataset<select><option>Choose a compatible dataset…</option></select></label></aside></div>`
      + `<div class="author-workspace"><label id="outsideLabel">Outside<select><option>Other</option></select></label></div>`,
  cases: [
    {
      target: '#lightLabel',
      rule: '.draft-source-recovery label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel'],
    },
    {
      target: '#darkLabel',
      rule: '.author-workspace[data-chrome="dark"] .draft-source-recovery label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(54, 72, 106)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel'],
    },
  ],
});
