import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 59: hover feedback for the admin surfaces
// (.admin-settings — AI provider settings in AISettings.tsx, Users and
// invitations in UserManagement.tsx, Operator user removal in
// OperatorUsers.tsx). Static audit follow-on to slices 53-58: no
// :hover rule in any stylesheet reaches these controls. All three
// surfaces render in <main> inside .app-shell, outside
// .author-workspace and .data-page, so the author/data/dialog hover
// rules never apply, and hovering a Save button, text field, or select
// changed nothing. Every control now takes #edf7f7 — style.css's one
// hover tint for both generic buttons (.author-workspace button:hover)
// and fields (.author-workspace select/input:hover, the .api-picker
// fields of slice 57). Background only, so resting geometry is
// identical. Static (no animation), so no reduced-motion variant is
// needed; disabled controls keep their flat resting state. Radio and
// checkbox inputs are excluded so the user-removal dialog's native
// controls keep OS rendering (the data-dialog / analysis-file-dialog
// exclusion pattern).
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const buttonHover = css.match(/\.admin-settings button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const fieldHover = css.match(/\.admin-settings input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\),\s*\.admin-settings select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the admin-settings button hover rule exists with the app tint', () => {
  assert.ok(buttonHover, 'expected the admin-settings button hover rule');
  assert.match(buttonHover[1], /background:\s*#edf7f7/);
});

test('the admin-settings field hover rule exists with the tint and native-control exclusions', () => {
  assert.ok(fieldHover, 'expected the admin-settings input/select hover rule');
  assert.match(fieldHover[1], /background:\s*#edf7f7/);
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
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#edf7f7/), 'the author button hover rule must still be present');
  assert.ok(css.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover rule must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><section class="admin-settings">
      <form><label>AI provider<select id="prov"><option>OpenAI</option></select></label>
      <label>Model ID<input id="model" value="gpt"></label>
      <button id="save" type="submit">Save provider and model</button><button id="off" type="submit" disabled>Save</button></form>
      <form><label>Replace API key<input id="key" type="password" value="x"></label></form>
      <section role="dialog"><fieldset><label><input id="radio" type="radio">Transfer</label>
      <label>New owner<select id="dlgselect"><option>Choose</option></select></label></fieldset></section>
    </section>`);
    const actual = await page.evaluate(() => {
      const found = {};
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = rule.selectorText || '';
          if (sel === '.admin-settings button:hover:not(:disabled)') found.button = rule;
          // Chromium normalizes [type=radio] to [type="radio"] in
          // selectorText, so match the field rule by its prefix.
          if (sel.includes('.admin-settings input:hover')) found.field = rule;
        }
      }
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const off = document.querySelector('#off');
      return {
        button: found.button ? measure(document.querySelector('#save'), found.button) : null,
        select: found.field ? measure(document.querySelector('#prov'), found.field) : null,
        input: found.field ? measure(document.querySelector('#model'), found.field) : null,
        password: found.field ? measure(document.querySelector('#key'), found.field) : null,
        dlgSelect: found.field ? measure(document.querySelector('#dlgselect'), found.field) : null,
        offMatches: found.button ? off.matches(found.button.selectorText.replace(':hover', '')) : null,
        radioMatches: found.field ? document.querySelector('#radio').matches('.admin-settings input:not(:disabled):not([type="radio"]):not([type="checkbox"])') : null,
      };
    });
    assert.ok(actual.button, 'expected the button hover rule in the CSSOM');
    assert.equal(actual.button.rest.background, 'rgb(239, 239, 239)');
    assert.equal(actual.button.hovered.background, 'rgb(237, 247, 247)');
    assert.equal(actual.button.rest.box, actual.button.hovered.box);
    assert.ok(actual.select, 'expected the field hover rule in the CSSOM');
    assert.equal(actual.select.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.select.hovered.background, 'rgb(237, 247, 247)');
    assert.equal(actual.select.rest.box, actual.select.hovered.box);
    assert.equal(actual.input.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.input.hovered.background, 'rgb(237, 247, 247)');
    assert.equal(actual.input.rest.box, actual.input.hovered.box);
    assert.equal(actual.password.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.password.hovered.background, 'rgb(237, 247, 247)');
    assert.equal(actual.password.rest.box, actual.password.hovered.box);
    assert.equal(actual.dlgSelect.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.dlgSelect.hovered.background, 'rgb(237, 247, 247)');
    assert.equal(actual.dlgSelect.rest.box, actual.dlgSelect.hovered.box);
    assert.equal(actual.offMatches, false, 'disabled buttons must be excluded from the hover rule');
    assert.equal(actual.radioMatches, false, 'radio inputs must keep native rendering');
  });
}
