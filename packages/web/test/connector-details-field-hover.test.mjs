import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 91: hover feedback for the connector
// details fields (.connector-details input / select in
// DataSources.tsx's ConnectorDetails — the setup form in the
// standalone connector gallery, aside.connector-details inside
// section.data-sources in .app-shell > main). Every input/select
// :hover rule in the cascade is scoped elsewhere — the data-dialog
// field hovers cover these same fields only inside the
// create-dataset dialog, and the data-page / author / admin /
// collection scopes do not reach the standalone gallery — so these
// fields matched no :hover rule. A CSSOM probe with all five real
// stylesheets (1,343 rules) in the real ancestor context confirmed
// zero matching :hover rules and a white rest for both the text
// input and the select, while the gallery's search input (slice 90)
// and its submit (slice 66) do step. They now take the app surfaces'
// established field hover tint (#eaf3f7 — the data-dialog fields
// these mirror, slices 27/48, and the connector search input,
// slice 90), so no new colour is introduced. The file input keeps
// its flat state, following the data-dialog rule's own exclusion of
// file/radio/checkbox inputs. Background only, so resting geometry
// is identical and there is no animation. The gallery is a
// fixed-light app-shell surface, so no dark variant is added.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const dataCss = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const rule = css.match(/^\.connector-details input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\), \.connector-details select:hover:not\(:disabled\)\s*\{([^}]*)\}/m);

test('the connector-details field hover rule exists and uses the established field tint', () => {
  assert.ok(rule, 'expected the .connector-details input/select :hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the data-dialog field hovers and the slice-90 search hover, so no new colour is introduced', () => {
  assert.ok(dataCss.match(/\.data-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\), \.data-dialog select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-dialog field hover must remain #eaf3f7');
  assert.ok(css.match(/\.connector-search input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the connector-search hover must remain #eaf3f7');
});

test('the field hover rule is paint-only: resting geometry and field presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting connector-details field rules are preserved', () => {
  assert.ok(css.match(/\.connector-details input, \.connector-details select\s*\{[^}]*background:\s*white/), 'the connector-details field resting background must remain white');
  assert.ok(css.match(/\.connector-details input:disabled, \.connector-details select:disabled\s*\{[^}]*background:\s*#f0f3f6/), 'the connector-details disabled field rule must remain');
  assert.ok(css.match(/\.connector-card:hover\s*\{[^}]*background:\s*#f8fbff/), 'the connector-card hover must remain');
});

describe('Connector-details field hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry, and fields outside .connector-details and the file input are out of scope', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<div class="app-shell"><main><section class="data-sources"><div class="connector-layout">`
      + `<aside class="connector-details" aria-label="File setup"><form>`
      + `<label>Worksheet name<input id="targetInput" type="text"></label>`
      + `<label>Format<select id="targetSelect"><option>CSV</option></select></label>`
      + `<label>File<input id="fileInput" type="file"></label>`
      + `</form></aside></div></section></main></div>`
      + `<input id="outsideInput" type="text"><select id="outsideSelect"><option>CSV</option></select>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '').includes('.connector-details input:hover')) ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const bare = found ? found.selectorText.replaceAll(':hover', '') : '';
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        input: found ? measure(document.querySelector('#targetInput'), found) : null,
        select: found ? measure(document.querySelector('#targetSelect'), found) : null,
        fileMatches: found ? document.querySelector('#fileInput').matches(bare) : null,
        outsideInputMatches: found ? document.querySelector('#outsideInput').matches(bare) : null,
        outsideSelectMatches: found ? document.querySelector('#outsideSelect').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    for (const kind of ['input', 'select']) {
      assert.equal(actual[kind].rest.background, 'rgb(255, 255, 255)', `connector-details ${kind} rest`);
      assert.equal(actual[kind].hovered.background, 'rgb(234, 243, 247)', `connector-details ${kind} hover`);
      assert.notEqual(actual[kind].rest.background, actual[kind].hovered.background);
      assert.equal(actual[kind].rest.color, actual[kind].hovered.color, `connector-details ${kind} colour unchanged on hover`);
      assert.equal(actual[kind].rest.box, actual[kind].hovered.box, `connector-details ${kind} geometry`);
    }
    assert.equal(actual.fileMatches, false, 'the file input inside .connector-details must be out of scope');
    assert.equal(actual.outsideInputMatches, false, 'a text input outside .connector-details must be out of scope');
    assert.equal(actual.outsideSelectMatches, false, 'a select outside .connector-details must be out of scope');
  });
});
