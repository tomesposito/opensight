import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 102: hover feedback for the operator
// user-removal dialog's radio labels (.admin-settings [role=dialog]
// label wrapping its radio in OperatorUsers.tsx's RemovalPrompt —
// "Transfer schedules to another user" and "Stop schedules", inside
// the fieldset of section.automation-notice in main.admin-settings).
// They had zero hover feedback. Every :hover rule that reaches the
// dialog is scoped elsewhere or excludes them — the admin field hover
// (slice 59) reaches the dialog's select and text inputs but
// deliberately excludes radio inputs so native controls keep their OS
// rendering, and no label hover rule reached the dialog — so neither
// the labels nor their radios matched any :hover rule, while the
// dialog's buttons and select do step. A CSSOM probe with all five
// real stylesheets in the real ancestor context confirmed zero
// matching :hover rules for the radio labels and a transparent rest.
// The labels now take #edf7f7, the admin surface's established hover
// tint (the slice-59 admin button and field hovers, and the slice-87
// admin link hover), so no new colour is introduced. The rule is on
// the label, not the radio: the radio keeps its native rendering,
// following the slice-94 connector-toggle, slice-95 sign-in-check,
// slice-96 favorites-filter, slice-97 toggle-label, slice-98
// O-mode-label, slice-99 parameter-checkbox, slice-100
// action-checkbox and slice-101 action-radio precedents where the
// label surface hovers and its inner input does not. The
// :has(> input[type=radio]) scope (the slice-99/100/101 precedent)
// targets exactly the radio labels; the "New schedule owner" label in
// the same fieldset stays out of scope because its select already
// hovers via the admin select hover. The admin surface is fixed
// light, so no dark variant. Background only, so resting geometry is
// identical and there is no animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.admin-settings \[role="dialog"\] label:has\(> input\[type=radio\]\):hover\s*\{([^}]*)\}/m);

test('the removal dialog radio label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .admin-settings [role=dialog] radio label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint matches the admin button and field hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.admin-settings button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the admin button hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.admin-settings input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\)/), 'the admin field hover must remain and keep its radio exclusion');
});

test('the removal dialog radio label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting removal dialog rules are preserved and the radio has no hover rule of its own', () => {
  assert.ok(styleCss.match(/\.admin-settings \[role="dialog"\] label:has\(input\[type="radio"\]\)\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/), 'the dialog radio label resting rule must remain');
  assert.ok(styleCss.match(/\.admin-settings \[role="dialog"\] input\[type="radio"\]\s*\{[^}]*width:\s*auto/), 'the dialog radio resting rule must remain');
  assert.ok(!/\.admin-settings \[role="dialog"\] input:hover/.test(styleCss), 'the radio must keep its native rendering with no hover rule of its own');
  assert.ok(!/data-chrome=dark[^\n]*removal|\.admin-settings \[data-chrome/.test(styleCss), 'the fixed-light admin surface must not gain a dark variant for this rule');
});

defineHoverCases('removal-radio hover', {
  html: `<main class="admin-settings"><section role="dialog" class="automation-notice"><h2>Remove user u1</h2>`
      + `<fieldset><legend>Owned schedules</legend>`
      + `<label id="transferLabel"><input id="transferRadio" type="radio" name="job-disposition">Transfer schedules to another user</label>`
      + `<label id="ownerLabel">New schedule owner<select aria-label="New schedule owner"><option>Choose a user</option></select></label>`
      + `<label id="stopLabel"><input type="radio" name="job-disposition">Stop schedules</label>`
      + `</fieldset></section>`
      + `<label id="outsideLabel"><input type="radio">Other label</label></main>`,
  cases: [
    {
      target: '#transferLabel',
      rule: '.admin-settings [role="dialog"] label:has(> input[type="radio"]):hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#transferRadio', '#ownerLabel', '#outsideLabel'],
    },
    {
      target: '#stopLabel',
      rule: '.admin-settings [role="dialog"] label:has(> input[type="radio"]):hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
