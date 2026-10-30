import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 46: hover feedback for the Calculated field
// dialog. The dialog renders outside .author-workspace (a sibling of it
// in Author.tsx), so the author hover rules never reach it — its resting
// and primary rules name .calculation-dialog explicitly, but no hover
// rule did. Its buttons, the "Use as" and "Function reference" selects,
// the Name input and the Expression textarea all changed nothing on
// hover while every other author control tinted. They now take the
// author hover language exactly (buttons: border + #eef3fd; primary:
// #2f66d8 with white text; fields: #eef3fd background only). The
// dialog's resting colors are fixed light (no dark-chrome variant
// exists for it), so no dark variant is added. Field rules change
// background only, so resting geometry is identical; static (no
// animation), so no reduced-motion variant is needed.
const css = styles['style.css'];

const buttonRule = css.match(/\.calculation-dialog button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const primaryRule = css.match(/\.calculation-dialog \.primary-button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const fieldRule = css.match(/\.calculation-dialog input:hover:not\(:disabled\), \.calculation-dialog select:hover:not\(:disabled\), \.calculation-dialog textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the calculation-dialog hover rules exist with the author tints', () => {
  assert.ok(buttonRule, 'expected the .calculation-dialog button hover rule');
  assert.match(buttonRule[1], /border-color:\s*#3b82f6/);
  assert.match(buttonRule[1], /background:\s*#eef3fd/);
  assert.ok(primaryRule, 'expected the .calculation-dialog primary-button hover rule');
  assert.match(primaryRule[1], /background:\s*#2f66d8/);
  assert.match(primaryRule[1], /color:\s*white/);
  assert.ok(fieldRule, 'expected the grouped .calculation-dialog field hover rule');
  assert.match(fieldRule[1], /background:\s*#eef3fd/);
});

test('the field hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(fieldRule, 'expected the field hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(fieldRule[1]), 'field hover must change background only');
});

test('the resting rules still reserve the geometry the hover keeps', () => {
  const restingButton = css.match(/\.author-workspace button, \.sheet-toolbar button, \.author-layout button, \.calculation-dialog button\s*\{([^}]*)\}/);
  assert.ok(restingButton, 'expected the grouped resting button rule');
  assert.match(restingButton[1], /padding:\s*4px 8px/);
  assert.match(restingButton[1], /background:\s*white/);
  const restingField = css.match(/\.calculation-dialog input, \.calculation-dialog textarea\s*\{([^}]*)\}/);
  assert.ok(restingField, 'expected the resting field rule naming .calculation-dialog');
  assert.match(restingField[1], /padding:\s*5px 6px/);
  assert.match(restingField[1], /border:\s*1px solid #c3cfe0/);
});

test('the dialog stays outside the author-workspace hover scope it now replaces', () => {
  // The author button hover rule must remain workspace/layout-scoped: the
  // dialog rule is a deliberate sibling, not a widening of that rule.
  const authorButton = css.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
  assert.ok(authorButton, 'expected the author button hover rule unchanged');
  assert.match(authorButton[1], /background:\s*#eef3fd/);
});

defineHoverCases('calculation-dialog hover', {
  html: `<dialog class="calculation-dialog" open><form>
      <label>Name<input id="name" value=""></label>
      <label>Use as<select id="role"><option>Measure (number)</option></select></label>
      <label>Expression<textarea id="expr" rows="5"></textarea></label>
      <div class="dialog-actions"><button type="button" id="cancel">Cancel</button><button type="submit" class="primary-button" id="create">Create field</button></div>
    </form></dialog>`,
  cases: [
    {
      target: '#name',
      rule: '.calculation-dialog input:hover:not(:disabled), .calculation-dialog select:hover:not(:disabled), .calculation-dialog textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
    {
      target: '#role',
      rule: '.calculation-dialog input:hover:not(:disabled), .calculation-dialog select:hover:not(:disabled), .calculation-dialog textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
    {
      target: '#expr',
      rule: '.calculation-dialog input:hover:not(:disabled), .calculation-dialog select:hover:not(:disabled), .calculation-dialog textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
    {
      target: '#cancel',
      rule: '.calculation-dialog button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
    {
      target: '#create',
      rule: '.calculation-dialog .primary-button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(59, 130, 246)' },
      hovered: { backgroundColor: 'rgb(47, 102, 216)' },
      paintOnly: true,
    },
  ],
});
