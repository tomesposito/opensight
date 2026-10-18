import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 31: hover feedback for the data-prep selects.
// A fresh behavioral hover audit (real mouse hover + computed-style delta,
// Chromium, every top-level offline-demo route) found the prep document-bar
// selects — the saved-dataset picker and the imported-dataset picker on
// #/data/preparation — were the largest remaining interactive controls with
// zero hover feedback: hovering them changed nothing. The surface already
// gives its buttons a hover state (.data-prep button:hover) but selects had
// none, so they take the surface's own button hover tint (#edf6fc).
// Background only, so resting geometry is identical; disabled selects keep
// their flat state. Static (no animation), so no reduced-motion variant is
// needed.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.data-prep\s+select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the prep select hover rule exists and uses the data-prep hover tint', () => {
  assert.ok(hoverRule, 'expected .data-prep select:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#edf6fc/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the prep select hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting prep-select rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.data-prep\s+(?:input,\s*)?\.data-prep\s+select[^{]*\{([^}]*)\}|(\.data-prep input, \.data-prep select, \.data-prep textarea \{[^}]*\})/);
  assert.ok(resting, 'expected the .data-prep select resting rule');
  assert.match(resting[0], /background:\s*white/);
  assert.match(resting[0], /border:\s*1px\s+solid/);
});

test('the prep select hover rule coexists with the prep button hover rule', () => {
  assert.ok(css.match(/\.data-prep\s+button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep button hover rule must still be present');
  assert.ok(hoverRule, 'expected the prep select hover rule');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="data-prep"><div class="prep-document-bar"><label>Dataset name<input value="demo"></label><label>Saved datasets<select><option value="">Unsaved dataset</option><option selected>demo-sales</option></select></label><label>Staged<select disabled><option>none</option></select></label></div></div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '').replace(/"/g, '');
          if (sel === '.data-prep select:hover:not(:disabled)') rules.push(rule);
        }
      }
      const plain = document.querySelector('.prep-document-bar select:not([disabled])');
      const disabled = document.querySelector('.prep-document-bar select[disabled]');
      const rest = { background: getComputedStyle(plain).backgroundColor, color: getComputedStyle(plain).color, box: JSON.stringify(plain.getBoundingClientRect().toJSON()) };
      // Simulate the matched rule: copy its declarations onto the select
      // exactly as the browser cascade would apply them on hover.
      const hover = rules[0];
      for (const prop of hover.style) plain.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(plain).backgroundColor, color: getComputedStyle(plain).color, box: JSON.stringify(plain.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        rest, hovered,
        plainMatches: plain.matches('.data-prep select:not(:disabled)'),
        disabledMatches: disabled.matches('.data-prep select:not(:disabled)'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(237, 246, 252)');
    assert.equal(actual.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.hovered.background, 'rgb(237, 246, 252)');
    assert.equal(actual.rest.color, actual.hovered.color, 'select text color must not change');
    assert.equal(actual.rest.box, actual.hovered.box);
    assert.ok(actual.plainMatches);
    assert.equal(actual.disabledMatches, false, 'disabled selects keep their flat state');
  });
}
