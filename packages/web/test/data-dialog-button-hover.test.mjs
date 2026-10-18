import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 30: hover feedback for the create-dataset dialog's
// plain buttons. A fresh behavioral hover audit extended past the 5 landing
// routes to every top-level offline-demo route (folders, data-prep, data
// sources, dataset/admin surfaces, #/analyses/new, #/data/new) found the
// "Upload file" and "Create data source" buttons in the create-dataset
// dialog's .data-dialog-tools row were the largest remaining interactive
// controls with zero hover feedback: hovering them changed nothing.
// Slice 16's rule covered .data-page buttons but not .data-dialog buttons,
// and the dialog buttons share the data surface's plain-button style (white
// bg, teal text), so they take the same established menu-item tint (#eaf3f7).
// This also gives the dialog header/footer plain buttons hover feedback for
// the first time. Background only, so resting geometry is identical; disabled
// buttons keep their flat state. Static (no animation), so no reduced-motion
// variant is needed.
const css = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.data-dialog\s+button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{([^}]*)\}/);

test('the dialog plain-button hover rule exists and uses the menu tint', () => {
  assert.ok(hoverRule, 'expected .data-dialog button:hover:not(:disabled):not(.data-primary):not([aria-selected=true])');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the dialog plain-button hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting dialog-button rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.data-dialog\s+button\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .data-dialog button resting rule');
  assert.match(resting[1], /background:\s*white/);
  assert.match(resting[1], /border:\s*1px\s+solid/);
});

test('the dialog-button hover rule coexists with the data-page button rule', () => {
  assert.ok(css.match(/\.data-page\s+button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page plain-button hover rule (slice 16) must still be present');
  assert.ok(hoverRule, 'expected the dialog plain-button hover rule');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="data-page"><dialog class="data-dialog" open><div class="data-dialog-body"><div class="data-dialog-tools"><button type="button">Upload file</button><button type="button" disabled>Staged</button><button type="button" class="data-primary">Continue</button></div></div></dialog></div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '').replace(/"/g, '');
          if (sel === '.data-dialog button:hover:not(:disabled):not(.data-primary):not([aria-selected=true])') rules.push(rule);
        }
      }
      const plain = document.querySelector('.data-dialog-tools button:not([disabled]):not(.data-primary)');
      const disabled = document.querySelector('.data-dialog-tools button[disabled]');
      const primary = document.querySelector('.data-dialog-tools button.data-primary');
      const rest = { background: getComputedStyle(plain).backgroundColor, color: getComputedStyle(plain).color, box: JSON.stringify(plain.getBoundingClientRect().toJSON()) };
      // Simulate the matched rule: copy its declarations onto the button
      // exactly as the browser cascade would apply them on hover.
      const hover = rules[0];
      for (const prop of hover.style) plain.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(plain).backgroundColor, color: getComputedStyle(plain).color, box: JSON.stringify(plain.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        rest, hovered,
        plainMatches: plain.matches('.data-dialog button:not(:disabled):not(.data-primary):not([aria-selected=true])'),
        primaryMatches: primary.matches('.data-dialog button:not(:disabled):not(.data-primary):not([aria-selected=true])'),
        disabledMatches: disabled.matches('.data-dialog button:not(:disabled):not(.data-primary):not([aria-selected=true])'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.hovered.background, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.color, actual.hovered.color, 'teal button text must not change');
    assert.equal(actual.rest.box, actual.hovered.box);
    assert.ok(actual.plainMatches);
    assert.equal(actual.primaryMatches, false, 'data-primary buttons keep their dark hover');
    assert.equal(actual.disabledMatches, false, 'disabled buttons keep their flat state');
  });
}
