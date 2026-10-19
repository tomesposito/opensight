import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 46: hover feedback for the Calculated field
// dialog. The dialog renders outside .author-workspace (a sibling of it
// in Author.tsx), so the author hover rules never reach it — its resting
// and primary rules name .calculation-dialog explicitly, but no hover
// rule did. Its buttons, the "Use as" and "Function reference" selects,
// the Name input and the Expression textarea all changed nothing on
// hover while every other author control tinted. They now take the
// author hover language exactly (buttons: border + #edf7f7; primary:
// #126e76 with white text; fields: #edf7f7 background only). The
// dialog's resting colors are fixed light (no dark-chrome variant
// exists for it), so no dark variant is added. Field rules change
// background only, so resting geometry is identical; static (no
// animation), so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const buttonRule = css.match(/\.calculation-dialog button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const primaryRule = css.match(/\.calculation-dialog \.primary-button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const fieldRule = css.match(/\.calculation-dialog input:hover:not\(:disabled\), \.calculation-dialog select:hover:not\(:disabled\), \.calculation-dialog textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the calculation-dialog hover rules exist with the author tints', () => {
  assert.ok(buttonRule, 'expected the .calculation-dialog button hover rule');
  assert.match(buttonRule[1], /border-color:\s*#157f88/);
  assert.match(buttonRule[1], /background:\s*#edf7f7/);
  assert.ok(primaryRule, 'expected the .calculation-dialog primary-button hover rule');
  assert.match(primaryRule[1], /background:\s*#126e76/);
  assert.match(primaryRule[1], /color:\s*white/);
  assert.ok(fieldRule, 'expected the grouped .calculation-dialog field hover rule');
  assert.match(fieldRule[1], /background:\s*#edf7f7/);
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
  assert.match(restingField[1], /border:\s*1px solid #c9d8de/);
});

test('the dialog stays outside the author-workspace hover scope it now replaces', () => {
  // The author button hover rule must remain workspace/layout-scoped: the
  // dialog rule is a deliberate sibling, not a widening of that rule.
  const authorButton = css.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
  assert.ok(authorButton, 'expected the author button hover rule unchanged');
  assert.match(authorButton[1], /background:\s*#edf7f7/);
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><dialog class="calculation-dialog" open><form>
      <label>Name<input id="name" value=""></label>
      <label>Use as<select id="role"><option>Measure (number)</option></select></label>
      <label>Expression<textarea id="expr" rows="5"></textarea></label>
      <div class="dialog-actions"><button type="button" id="cancel">Cancel</button><button type="submit" class="primary-button" id="create">Create field</button></div>
    </form></dialog>`);
    const actual = await page.evaluate(() => {
      const bySelector = {};
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '');
          if (sel.includes('.calculation-dialog') && sel.includes(':hover')) bySelector[sel] = rule;
        }
      }
      const apply = (el, rule) => { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); };
      const measure = (id, rule) => {
        const el = document.querySelector(id);
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        apply(el, rule);
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      const field = bySelector['.calculation-dialog input:hover:not(:disabled), .calculation-dialog select:hover:not(:disabled), .calculation-dialog textarea:hover:not(:disabled)'];
      const button = bySelector['.calculation-dialog button:hover:not(:disabled)'];
      const primary = bySelector['.calculation-dialog .primary-button:hover:not(:disabled)'];
      return {
        ruleKeys: Object.keys(bySelector),
        name: field ? measure('#name', field) : null,
        role: field ? measure('#role', field) : null,
        expr: field ? measure('#expr', field) : null,
        cancel: button ? measure('#cancel', button) : null,
        createBg: primary ? (() => { const el = document.querySelector('#create'); apply(el, primary); return getComputedStyle(el).backgroundColor; })() : null,
      };
    });
    assert.equal(actual.ruleKeys.length, 3, 'expected exactly the three calculation-dialog hover rules');
    for (const key of ['name', 'role', 'expr']) {
      assert.ok(actual[key], `expected measurements for ${key}`);
      assert.equal(actual[key].hovered.background, 'rgb(237, 247, 247)');
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.box, actual[key].hovered.box);
    }
    assert.ok(actual.cancel, 'expected measurements for the Cancel button');
    assert.equal(actual.cancel.hovered.background, 'rgb(237, 247, 247)');
    assert.equal(actual.cancel.rest.box, actual.cancel.hovered.box);
    assert.equal(actual.createBg, 'rgb(18, 110, 118)');
  });
}
