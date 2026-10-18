import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 29: hover feedback for the selected sheet tab.
// A fresh behavioral hover audit of the landing surfaces
// (home/my-stuff/analyses/dashboards/data — real mouse hover with
// computed-style delta measurement) found the selected sheet tab (the home
// "Overview" tab, aria-current="page") was the last interactive control on
// the landing surfaces with zero hover feedback: hovering it changed nothing.
// Slice 18's rule deliberately excluded the selected tab; the selected tab
// now takes the #eaf3f7 menu-item tint on hover (the slice-28
// selected-data-tab language), so it reads interactive while staying visually
// distinct at rest (teal text + underline unchanged). Background only, so
// resting geometry is identical; disabled tabs keep their flat state. Static
// (no animation), so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.sheet-tabs\s+button\[aria-current\]:hover:not\(:disabled\),\s*\.sheet-tabs\s+button\[aria-selected=true\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the selected sheet tab has a hover state using the menu tint', () => {
  assert.ok(hoverRule, 'expected .sheet-tabs button[aria-current]:hover:not(:disabled), .sheet-tabs button[aria-selected=true]:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the selected sheet-tab hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting selected-tab rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.sheet-tabs\s+button\[aria-current\]\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .sheet-tabs button[aria-current] resting rule');
  assert.match(resting[1], /color:\s*#126e76/);
  assert.match(resting[1], /border-color:\s*#157f88/);
});

test('the selected-tab hover rule coexists with the unselected-tab hover rule', () => {
  assert.ok(css.match(/\.sheet-tabs\s+button:hover:not\(\[aria-current\]\):not\(\[aria-selected=true\]\)\s*\{[^}]*color:\s*#126e76/), 'the unselected-tab hover rule (slice 18) must still be present');
  assert.ok(hoverRule, 'expected the selected sheet-tab hover rule');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="sheet-tabs"><button type="button" aria-current="page">Overview<span>5 visuals</span></button><button type="button" aria-selected="true">Sheet 2</button><button type="button" aria-current="page" disabled>Archived</button></div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '').replace(/"/g, '');
          if (sel === '.sheet-tabs button[aria-current]:hover:not(:disabled), .sheet-tabs button[aria-selected=true]:hover:not(:disabled)') rules.push(rule);
        }
      }
      const current = document.querySelector('.sheet-tabs button[aria-current="page"]:not([disabled])');
      const selected = document.querySelector('.sheet-tabs button[aria-selected="true"]');
      const disabled = document.querySelector('.sheet-tabs button[aria-current="page"][disabled]');
      const rest = { background: getComputedStyle(current).backgroundColor, color: getComputedStyle(current).color, box: JSON.stringify(current.getBoundingClientRect().toJSON()) };
      // Simulate the matched rule: copy its declarations onto the selected
      // tab exactly as the browser cascade would apply them on hover.
      const hover = rules[0];
      for (const prop of hover.style) current.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(current).backgroundColor, color: getComputedStyle(current).color, box: JSON.stringify(current.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        rest, hovered,
        currentMatches: current.matches('.sheet-tabs button[aria-current]:not(:disabled)'),
        selectedMatches: selected.matches('.sheet-tabs button[aria-selected=true]:not(:disabled)'),
        disabledMatches: disabled.matches('.sheet-tabs button[aria-current]:hover:not(:disabled), .sheet-tabs button[aria-selected=true]:hover:not(:disabled)'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.background, 'rgba(0, 0, 0, 0)');
    assert.equal(actual.hovered.background, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.color, actual.hovered.color, 'teal selected text must not change');
    assert.equal(actual.rest.box, actual.hovered.box);
    assert.ok(actual.currentMatches);
    assert.ok(actual.selectedMatches);
    assert.equal(actual.disabledMatches, false);
  });
}
