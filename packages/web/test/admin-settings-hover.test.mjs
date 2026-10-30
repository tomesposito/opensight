import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 59: hover feedback for the admin surfaces
// (.admin-settings — AI provider settings in AISettings.tsx, Users and
// invitations in UserManagement.tsx, Operator user removal in
// OperatorUsers.tsx). Static audit follow-on to slices 53-58: no
// :hover rule in any stylesheet reaches these controls. All three
// surfaces render in <main> inside .app-shell, outside
// .author-workspace and .data-page, so the author/data/dialog hover
// rules never apply, and hovering a Save button, text field, or select
// changed nothing. Every control now takes #eef3fd — style.css's one
// hover tint for both generic buttons (.author-workspace button:hover)
// and fields (.author-workspace select/input:hover, the .api-picker
// fields of slice 57). Background only, so resting geometry is
// identical. Static (no animation), so no reduced-motion variant is
// needed; disabled controls keep their flat resting state. Radio and
// checkbox inputs are excluded so the user-removal dialog's native
// controls keep OS rendering (the data-dialog / analysis-file-dialog
// exclusion pattern).
const css = styles['style.css'];

const buttonHover = css.match(/\.admin-settings button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const fieldHover = css.match(/\.admin-settings input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\),\s*\.admin-settings select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the admin-settings button hover rule exists with the app tint', () => {
  assert.ok(buttonHover, 'expected the admin-settings button hover rule');
  assert.match(buttonHover[1], /background:\s*#eef3fd/);
});

test('the admin-settings field hover rule exists with the tint and native-control exclusions', () => {
  assert.ok(fieldHover, 'expected the admin-settings input/select hover rule');
  assert.match(fieldHover[1], /background:\s*#eef3fd/);
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [buttonHover, fieldHover]) {
    assert.ok(rule, 'expected both admin-settings hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the resting admin-settings rules still reserve the geometry the hover keeps', () => {
  const fields = css.match(/\.admin-settings input,\s*\.admin-settings select\s*\{([^}]*)\}/);
  assert.ok(fields, 'expected the admin-settings input/select resting rule');
  assert.match(fields[1], /padding:\s*\.65rem/);
  const button = css.match(/\.admin-settings button\s*\{([^}]*)\}/);
  assert.ok(button, 'expected the admin-settings button resting rule');
  assert.match(button[1], /padding:\s*\.65rem 1rem/);
});

test('the author hover rules are untouched', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#eef3fd/), 'the author button hover rule must still be present');
  assert.ok(css.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the author select hover rule must still be present');
});

defineHoverCases('admin-settings hover', {
  html: `<section class="admin-settings">
      <form><label>AI provider<select id="prov"><option>OpenAI</option></select></label>
      <label>Model ID<input id="model" value="gpt"></label>
      <button id="save" type="submit">Save provider and model</button><button id="off" type="submit" disabled>Save</button></form>
      <form><label>Replace API key<input id="key" type="password" value="x"></label></form>
      <section role="dialog"><fieldset><label><input id="radio" type="radio">Transfer</label>
      <label>New owner<select id="dlgselect"><option>Choose</option></select></label></fieldset></section>
    </section>`,
  cases: [
    {
      target: '#save',
      rule: '.admin-settings button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(239, 239, 239)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      excluded: ['#off', '#radio'],
    },
    {
      target: '#prov',
      rule: '.admin-settings input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]), .admin-settings select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
    {
      target: '#model',
      rule: '.admin-settings input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]), .admin-settings select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
    {
      target: '#key',
      rule: '.admin-settings input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]), .admin-settings select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
    {
      target: '#dlgselect',
      rule: '.admin-settings input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]), .admin-settings select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
  ],
});
