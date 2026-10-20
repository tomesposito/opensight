import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 52: hover background for the command palette
// and global search result rows (.command-palette li / .global-search
// li). A fresh behavioral audit with a query typed (slice 47 audited
// the palette empty) measured the rows underline-only on hover — no
// background change — while the keyboard-selected row rests fully
// tinted with var(--palette-selected) and slice 47 gave the dialogs'
// Close buttons, search inputs and filter chips that same tint on
// hover. A full-row click target that only underlines reads as a text
// link and never shows its hit area. The rows now take
// var(--palette-selected) as their hover background, keeping the
// existing underline; the selected row already rests at that tint, so
// its hover is unchanged, and dark chrome resolves the var to #293f55.
// Background only, so resting geometry is identical. Static (no
// animation), so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const paletteHover = css.match(/\.command-palette li:hover\s*\{([^}]*)\}/);
const searchHover = css.match(/\.global-search li:hover\s*\{([^}]*)\}/);

test('both palette result-row hover rules exist and use the selected tint', () => {
  assert.ok(paletteHover, 'expected the .command-palette li:hover rule');
  assert.match(paletteHover[1], /background:\s*var\(--palette-selected\)/);
  assert.ok(searchHover, 'expected the .global-search li:hover rule');
  assert.match(searchHover[1], /background:\s*var\(--palette-selected\)/);
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [paletteHover, searchHover]) {
    assert.ok(rule, 'expected both palette row hover rules');
    assert.ok(!/padding|margin|border|width|height|font-size|box-shadow/.test(rule[1]), 'hover must change background (and the pre-existing underline) only');
    assert.match(rule[1], /text-decoration:\s*underline/, 'the pre-existing underline treatment is kept');
  }
});

test('the resting row rules still reserve the geometry the hover keeps', () => {
  const paletteRest = css.match(/\.command-palette li\s*\{([^}]*)\}/);
  assert.ok(paletteRest, 'expected the .command-palette li resting rule');
  assert.match(paletteRest[1], /padding:\s*8px/);
  assert.match(paletteRest[1], /border-left:\s*4px solid transparent/);
  assert.match(paletteRest[1], /cursor:\s*pointer/);
  const searchRest = css.match(/\.global-search li\.search-row\s*\{([^}]*)\}/);
  assert.ok(searchRest, 'expected the .global-search li.search-row resting rule');
  assert.match(searchRest[1], /padding:\s*8px/);
  assert.match(searchRest[1], /border-left:\s*4px solid transparent/);
  assert.match(searchRest[1], /cursor:\s*pointer/);
});

test('the hover tint coexists with the selected-row and slice-47 rules', () => {
  assert.ok(css.match(/\.command-palette li\[aria-selected=true\]\s*\{[^}]*background:\s*var\(--palette-selected\)/), 'the command palette selected-row rule must still be present');
  assert.ok(css.match(/\.global-search li\[aria-selected=true\]\s*\{[^}]*background:\s*var\(--palette-selected\)/), 'the global search selected-row rule must still be present');
  assert.ok(css.match(/\.command-palette header button:hover/), 'the slice-47 palette header hover rule must still be present');
  assert.ok(css.match(/\.global-search \.search-types button:hover/), 'the slice-47 search chip hover rule must still be present');
  assert.ok(css.match(/\.command-palette\[data-chrome=dark\]\s*\{[^}]*--palette-selected:\s*#293f55/), 'the dark-chrome palette-selected value must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><dialog class="command-palette" open>
      <ul><li id="row" aria-selected="false">Go to Data preparation</li></ul>
    </dialog>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '') === '.command-palette li:hover') rules.push(rule);
        }
      }
      const row = document.querySelector('#row');
      const rest = { background: getComputedStyle(row).backgroundColor, box: JSON.stringify(row.getBoundingClientRect().toJSON()) };
      const hover = rules[0];
      // Assign the rule's whole declaration block: the background is a
      // var() shorthand, which does not survive longhand-by-longhand
      // copying, but resolves against the dialog's --palette-selected
      // when applied as cssText.
      if (hover) row.style.cssText = hover.style.cssText;
      const hovered = { background: getComputedStyle(row).backgroundColor, box: JSON.stringify(row.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        backgroundValue: rules.length ? rules[0].style.getPropertyValue('background') : null,
        rest,
        hovered,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.backgroundValue, 'var(--palette-selected)');
    assert.equal(actual.rest.background, 'rgba(0, 0, 0, 0)');
    assert.equal(actual.hovered.background, 'rgb(226, 242, 250)');
    assert.notEqual(actual.rest.background, actual.hovered.background);
    assert.equal(actual.rest.box, actual.hovered.box);
  });
}
