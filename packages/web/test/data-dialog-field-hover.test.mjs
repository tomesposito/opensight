import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 48: hover feedback for the data dialogs' fields.
// A behavioral hover probe (real mouse + computed-style delta, replica
// carrying the real data-section.css, markup mirroring CreateDatasetDialog
// and DataSectionUI) measured the create-dataset dialog's search input
// (260x28), a config-form text input and a select white -> white on hover,
// while the dialog's plain buttons tinted (slices 16/30) and its primary
// button darkened. Slices 21/27 gave the .data-page select and search input
// the data surface's menu-item tint (#eaf3f7) but never the .data-dialog
// fields. They now take the same tint. Native radio/checkbox/file inputs
// keep their OS rendering (the slice-44 exclusion pattern). Background
// only, so resting geometry is identical; disabled fields keep their flat
// state. Static (no animation), so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const fieldRule = css.match(/\.data-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\), \.data-dialog select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the data-dialog field hover rule exists and uses the menu tint', () => {
  assert.ok(fieldRule, 'expected the grouped .data-dialog input/select hover rule');
  assert.match(fieldRule[1], /background:\s*#eaf3f7/);
});

test('the field hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(fieldRule, 'expected the data-dialog field hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(fieldRule[1]), 'field hover must change background only');
});

test('the resting dialog-field rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.data-page input, \.data-dialog input, \.data-page select, \.data-dialog select\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the grouped resting field rule naming .data-dialog');
  assert.match(resting[1], /padding:\s*4px 8px/);
  assert.match(resting[1], /border:\s*1px solid #9eb0ba/);
  assert.match(resting[1], /background:\s*white/);
});

test('the dialog field hover rule coexists with the page field rules', () => {
  assert.ok(css.match(/\.data-page select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page select hover rule (slice 21) must still be present');
  assert.ok(css.match(/\.data-page input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page search-input hover rule (slice 27) must still be present');
  assert.ok(css.match(/\.data-dialog button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-dialog button hover rule (slice 30) must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><dialog class="data-dialog" open><div class="data-dialog-body">
      <div class="data-dialog-tools"><input id="search" type="search" placeholder="Search data sources"></div>
      <label>Connection name<input id="name" type="text" value="x"></label>
      <label>Region<select id="region"><option>us-east-1</option></select></label>
      <label class="data-connector-tile"><input id="tile-radio" type="radio" name="c"></label>
    </div></dialog>`);
    const actual = await page.evaluate(() => {
      let field = null;
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '');
          if (sel.includes('.data-dialog input:hover')) field = rule;
        }
      }
      const apply = (el, rule) => { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); };
      const measure = (id) => {
        const el = document.querySelector(id);
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        apply(el, field);
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      return {
        found: !!field,
        selector: field ? field.selectorText : null,
        search: field ? measure('#search') : null,
        name: field ? measure('#name') : null,
        region: field ? measure('#region') : null,
        radioMatches: field ? document.querySelector('#tile-radio').matches(field.selectorText.split(',')[0]) : null,
      };
    });
    assert.ok(actual.found, 'expected the data-dialog field hover rule in the stylesheet');
    for (const key of ['search', 'name', 'region']) {
      assert.ok(actual[key], `expected measurements for ${key}`);
      assert.equal(actual[key].rest.background, 'rgb(255, 255, 255)');
      assert.equal(actual[key].hovered.background, 'rgb(234, 243, 247)');
      assert.equal(actual[key].rest.box, actual[key].hovered.box);
    }
    assert.equal(actual.radioMatches, false, 'the tile radio input must be excluded from the field hover rule');
  });
}
