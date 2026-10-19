import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 48: hover feedback for the creation dialogs'
// search inputs. A fresh behavioral hover audit that OPENED both creation
// dialogs (real mouse hover + computed-style delta, Chromium, demo dist)
// found exactly two real zero-hover classes left in them:
// - the Create Analysis dialog's dataset search input (.dataset-picker-search
//   input, 420x34) measured white -> white, while the dialog's buttons and
//   its pagination select tinted (#edf7fc, base + slice 23 rules) — the
//   dialog had button and select hover rules but no input rule;
// - the Create Dataset dialog's search inputs (.data-dialog-tools
//   input[type=search], 260x28, both the dataset and connector stages)
//   measured white -> white, while the dialog's buttons tinted (slice 30).
//   Slice 27 gave .data-page search inputs hover but not .data-dialog ones
//   — the same unfinished-member pattern slice 30 fixed for dialog buttons.
// Each input takes its own surface's established hover tint: #edf7fc for
// the create-analysis dialog, #eaf3f7 (the data surface's menu tint) for
// the data dialog. Background only, so resting geometry is identical;
// disabled inputs keep their flat state. The audit's other zero-hover hits
// were the 13x13 native radio inputs inside the dataset table and the
// connector tiles — by-design native controls (slices 33/37/38 precedent);
// the connector tiles are a selection-card affordance, a separate lead.
// Static (no animation), so no reduced-motion variant is needed.
const dataCss = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const dataRule = dataCss.match(/\.data-dialog\s+input\[type=search\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const createRule = styleCss.match(/\.create-analysis-dialog\s+input\[type=search\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the data-dialog search input has a hover state using the data menu tint', () => {
  assert.ok(dataRule, 'expected .data-dialog input[type=search]:hover:not(:disabled)');
  assert.match(dataRule[1], /background:\s*#eaf3f7/);
});

test('the create-analysis-dialog search input has a hover state using the dialog tint', () => {
  assert.ok(createRule, 'expected .create-analysis-dialog input[type=search]:hover:not(:disabled)');
  assert.match(createRule[1], /background:\s*#edf7fc/);
});

test('both hover rules are paint-only: resting geometry cannot shift', () => {
  assert.ok(dataRule && createRule, 'expected both dialog search hover rules');
  for (const [, body] of [dataRule, createRule]) {
    assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(body), 'hover must change background only');
  }
});

test('the resting input rules still reserve the geometry the hovers keep', () => {
  assert.match(dataCss, /\.data-page\s+input,\s*\.data-dialog\s+input[^{}]*\{[^}]*border:\s*1px\s+solid\s+#9eb0ba[^}]*background:\s*white/, 'data-dialog resting input rule must remain');
  assert.match(styleCss, /\.dataset-picker-search\s+input\s*\{[^}]*border:\s*1px\s+solid\s+#969da3[^}]*background:\s*#fff/, 'dataset-picker search resting rule must remain');
});

test('the new rules coexist with the earlier dialog hover rules', () => {
  assert.ok(dataCss.match(/\.data-dialog\s+button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'slice-30 data-dialog button rule must still be present');
  assert.ok(dataCss.match(/\.data-page\s+input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'slice-27 data-page search rule must still be present');
  assert.ok(styleCss.match(/\.create-analysis-dialog\s+button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7fc/), 'create-analysis button rule must still be present');
  assert.ok(styleCss.match(/\.create-analysis-dialog\s+select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7fc/), 'slice-23 create-analysis select rule must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${dataCss}</style><style>${styleCss}</style>
      <div class="data-dialog"><div class="data-dialog-tools"><input type="search" aria-label="Search data sources"><input type="search" aria-label="Disabled search" disabled></div></div>
      <dialog class="create-analysis-dialog" open><div class="dataset-picker-search"><input type="search" aria-label="Search datasets by name"></div></dialog>`);
    const actual = await page.evaluate(() => {
      const found = {};
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '').replace(/"/g, '');
          if (sel === '.data-dialog input[type=search]:hover:not(:disabled)') found.data = rule;
          if (sel === '.create-analysis-dialog input[type=search]:hover:not(:disabled)') found.create = rule;
        }
      }
      const measure = (input, rule) => {
        const rest = { background: getComputedStyle(input).backgroundColor, box: JSON.stringify(input.getBoundingClientRect().toJSON()) };
        for (const prop of rule.style) input.style.setProperty(prop, rule.style.getPropertyValue(prop));
        const hovered = { background: getComputedStyle(input).backgroundColor, box: JSON.stringify(input.getBoundingClientRect().toJSON()) };
        return { rest, hovered, props: [...rule.style] };
      };
      const dataInput = document.querySelector('.data-dialog input:not([disabled])');
      const disabled = document.querySelector('.data-dialog input[disabled]');
      const createInput = document.querySelector('.create-analysis-dialog input');
      return {
        data: found.data ? measure(dataInput, found.data) : null,
        create: found.create ? measure(createInput, found.create) : null,
        disabledMatches: disabled.matches('.data-dialog input[type=search]:hover:not(:disabled)'),
        disabledBackground: getComputedStyle(disabled).backgroundColor,
      };
    });
    assert.ok(actual.data, 'expected the data-dialog hover rule in the CSSOM');
    assert.ok(actual.create, 'expected the create-analysis hover rule in the CSSOM');
    assert.ok(actual.data.props.every(p => p.startsWith('background')), 'data hover must set background only');
    assert.ok(actual.create.props.every(p => p.startsWith('background')), 'create hover must set background only');
    assert.equal(actual.data.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.data.hovered.background, 'rgb(234, 243, 247)');
    assert.equal(actual.data.rest.box, actual.data.hovered.box);
    assert.equal(actual.create.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.create.hovered.background, 'rgb(237, 247, 252)');
    assert.equal(actual.create.rest.box, actual.create.hovered.box);
    assert.equal(actual.disabledMatches, false);
    assert.equal(actual.disabledBackground, 'rgb(255, 255, 255)');
  });
}
