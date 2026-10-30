import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 110: hover feedback for the admin
// surfaces' field labels (.admin-settings label — "AI provider",
// "Model ID" and "Replace API key" in AISettings.tsx, "Sign-in
// user ID", "Display name" and "Role" in UserManagement.tsx,
// "Tenant ID" and "Operator credential" in OperatorUsers.tsx,
// and the standalone "Single-use invitation link" label in
// UserManagement.tsx). The .admin-settings label rule lays each
// label out as a grid (text line, gap, field), so the label has
// real visible area, but it had zero hover feedback: every label
// :hover rule in the cascade is scoped elsewhere (author toggles,
// parameter/action editor labels, the O-mode notice label,
// connector/sign-in/collection labels, the data-prep label
// series, the change-type label, and the admin dialog's own
// radio labels from slice 102), so the label rested transparent
// and hovering its text or gap changed nothing, while only the
// field inside it tinted via the slice-59 admin field hover.
// This was the fresh zero-hover audit on a new surface left by
// slice 109. The label now takes #eef3fd, the admin surface's
// established hover tint (the slice-59 admin button and field
// hovers and the slice-87 admin link hover), so no new colour
// is introduced. The dialog radio labels already take the
// identical tint via slice 102, so the broader scope changes
// nothing there. Background only, so resting geometry is
// identical and there is no animation; the admin surface is
// fixed light, so no dark variant is added.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.admin-settings label:hover\s*\{([^}]*)\}/m);

test('the admin-settings label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .admin-settings label :hover rule');
  assert.match(rule[1], /background:\s*#eef3fd/);
});

test('the hover tint matches the admin button, field and link hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.admin-settings button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the admin button hover must remain #eef3fd');
  assert.ok(styleCss.match(/\.admin-settings select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the admin select hover must remain #eef3fd');
  assert.ok(styleCss.match(/^\.admin-settings a:hover\s*\{[^}]*background:\s*#eef3fd/m), 'the admin link hover must remain #eef3fd');
});

test('the admin-settings label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting admin-settings label rule is preserved, the dialog radio hover keeps the same tint, and there is no dark variant', () => {
  assert.ok(styleCss.match(/^\.admin-settings label\s*\{[^}]*display:\s*grid[^}]*gap:\s*\.4rem[^}]*flex:\s*1 1 14rem/m), 'the admin label resting rule must remain');
  assert.ok(styleCss.match(/\.admin-settings \[role="dialog"\] label:has\(> input\[type=radio\]\):hover\s*\{[^}]*background:\s*#eef3fd/), 'the slice-102 dialog radio label hover must remain #eef3fd');
  assert.ok(!styleCss.match(/data-chrome=dark\] \.admin-settings label:hover/), 'the fixed-light admin surface must have no dark label hover variant');
});

defineHoverCases('admin-label hover', {
  html: `<section class="admin-settings"><h1>AI provider settings</h1><form>`
      + `<label id="aiLabel">AI provider<select><option>OpenAI</option></select></label>`
      + `<label id="modelLabel">Model ID<input value="x"/></label></form>`
      + `<label id="linkLabel">Single-use invitation link<input readonly value="y"/></label></section>`
      + `<main class="admin-settings"><form><label id="tenantLabel">Tenant ID<input value="t"/></label></form></main>`
      + `<label id="outsideLabel">Outside<input/></label>`,
  cases: [
    {
      target: '#aiLabel',
      rule: '.admin-settings label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel'],
    },
    {
      target: '#modelLabel',
      rule: '.admin-settings label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#linkLabel',
      rule: '.admin-settings label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#tenantLabel',
      rule: '.admin-settings label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
