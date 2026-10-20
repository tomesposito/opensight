import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 57: hover feedback for the API explorer's
// picker form (.api-picker in ApiExplorer, Application.tsx — Resource
// select, Resource ID input, "Load definition" submit button). Static
// audit follow-on to slices 53-56: no :hover rule in any stylesheet
// reaches these controls. The form renders in <main> inside .app-shell,
// outside .author-workspace and .data-page, so the author/data/dialog
// hover rules never apply; the Author page's own .api-picker instance
// sits inside .author-workspace and is already covered by the author
// hover rules (equal specificity, later in style.css, so it keeps its
// author hover). The button now takes the app-wide primary hover step
// (#157f88 -> #126e76, the primary-button/account-panel language) and
// the select and input take style.css's field hover tint (#edf7f7, the
// author select/input language). Background only, so resting geometry
// is identical. Static (no animation), so no reduced-motion variant
// is needed; disabled controls keep their flat resting state.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const buttonHover = css.match(/\.api-picker button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const fieldHover = css.match(/\.api-picker select:hover:not\(:disabled\),\s*\.api-picker input:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the api-picker button hover rule exists with the primary step', () => {
  assert.ok(buttonHover, 'expected the api-picker button hover rule');
  assert.match(buttonHover[1], /background:\s*#126e76/);
});

test('the api-picker field hover rule exists with the field tint', () => {
  assert.ok(fieldHover, 'expected the api-picker select/input hover rule');
  assert.match(fieldHover[1], /background:\s*#edf7f7/);
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [buttonHover, fieldHover]) {
    assert.ok(rule, 'expected both api-picker hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the resting api-picker rules still reserve the geometry the hover keeps', () => {
  const button = css.match(/\.api-picker button\s*\{([^}]*)\}/);
  assert.ok(button, 'expected the api-picker button resting rule');
  assert.match(button[1], /padding:\s*11px 18px/);
  assert.match(button[1], /background:\s*#157f88/);
  const input = css.match(/\.api-picker input\s*\{([^}]*)\}/);
  assert.ok(input, 'expected the api-picker input resting rule');
  assert.match(input[1], /padding:\s*10px/);
  assert.match(input[1], /border:\s*1px solid #c9d8de/);
});

test('the author hover rules the Author-page instance relies on are untouched', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#edf7f7/), 'the author button hover rule must still be present');
  assert.ok(css.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover rule must still be present');
  assert.ok(css.indexOf('.author-workspace button:hover') > css.indexOf('.api-picker button:hover'), 'the author hover rule must stay later in the file so the Author-page .api-picker instance keeps its author hover');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><form class="api-picker">
      <label>Resource<select id="kind"><option value="analysis">Analysis</option></select></label>
      <label class="resource-id">Resource ID<input id="rid" value="renderable-sales"></label>
      <button id="load" type="submit">Load definition</button><button id="off" type="submit" disabled>Load definition</button>
    </form>`);
    const actual = await page.evaluate(() => {
      const found = {};
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = rule.selectorText || '';
          if (sel === '.api-picker button:hover:not(:disabled)') found.button = rule;
          if (sel === '.api-picker select:hover:not(:disabled), .api-picker input:hover:not(:disabled)') found.field = rule;
        }
      }
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      const off = document.querySelector('#off');
      return {
        button: found.button ? measure(document.querySelector('#load'), found.button) : null,
        select: found.field ? measure(document.querySelector('#kind'), found.field) : null,
        input: found.field ? measure(document.querySelector('#rid'), found.field) : null,
        offMatches: found.button ? off.matches(found.button.selectorText.replace(':hover', '')) : null,
      };
    });
    assert.ok(actual.button, 'expected the button hover rule in the CSSOM');
    assert.equal(actual.button.rest.background, 'rgb(21, 127, 136)');
    assert.equal(actual.button.hovered.background, 'rgb(18, 110, 118)');
    assert.equal(actual.button.rest.box, actual.button.hovered.box);
    assert.ok(actual.select, 'expected the field hover rule in the CSSOM');
    assert.equal(actual.select.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.select.hovered.background, 'rgb(237, 247, 247)');
    assert.equal(actual.select.rest.box, actual.select.hovered.box);
    assert.equal(actual.input.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.input.hovered.background, 'rgb(237, 247, 247)');
    assert.equal(actual.input.rest.box, actual.input.hovered.box);
    assert.equal(actual.offMatches, false, 'disabled buttons must be excluded from the hover rule');
  });
}
