import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 28: hover feedback for the selected data-page tab.
// A fresh interactive-state audit of the landing surfaces
// (home/my-stuff/analyses/dashboards/data, in-page CLS at 0 on every route,
// no page errors) found the selected tab (e.g. "Datasets", aria-selected=true)
// was the last interactive control on the landing surfaces with zero hover
// state: hovering it changed nothing, while the unselected tabs and the
// surrounding controls already take the data page's established menu-item
// hover tint (#eaf3f7, slices 16/21/27). The selected tab takes the same tint
// on hover; its resting state (bg #eff4f6, bold, teal bottom border) stays
// distinct. Background only, so resting geometry is identical. Static (no
// animation), so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.data-tabs\s+button\[aria-selected=true\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the selected data tab has a hover state using the menu tint', () => {
  assert.ok(hoverRule, 'expected .data-tabs button[aria-selected=true]:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected .data-tabs button[aria-selected=true]:hover:not(:disabled)');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting selected-tab rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.data-tabs\s+button\[aria-selected=true\]\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .data-tabs button[aria-selected=true] resting rule');
  assert.match(resting[1], /background:\s*#eff4f6/);
  assert.match(resting[1], /border-bottom-color:\s*#176b88/);
});

test('the selected-tab hover rule coexists with the general tab hover rule', () => {
  assert.ok(css.match(/\.data-page\s+button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the unselected-tab hover rule (slice 16) must still be present');
  assert.ok(hoverRule, 'expected .data-tabs button[aria-selected=true]:hover:not(:disabled)');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><section class="data-page"><div class="data-tabs"><button type="button" role="tab" aria-selected="true">Datasets</button><button type="button" role="tab" aria-selected="false">Sources</button><button type="button" role="tab" aria-selected="true" disabled>Archived</button></div></section>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '').replace(/"/g, '') === '.data-tabs button[aria-selected=true]:hover:not(:disabled)') rules.push(rule);
        }
      }
      const enabled = document.querySelector('.data-tabs button[aria-selected="true"]:not([disabled])');
      const disabled = document.querySelector('.data-tabs button[aria-selected="true"][disabled]');
      const rest = { background: getComputedStyle(enabled).backgroundColor, box: JSON.stringify(enabled.getBoundingClientRect().toJSON()) };
      // Simulate the matched rule: copy its declarations onto the enabled
      // tab exactly as the browser cascade would apply them on hover.
      const hover = rules[0];
      for (const prop of hover.style) enabled.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(enabled).backgroundColor, box: JSON.stringify(enabled.getBoundingClientRect().toJSON()) };
      const disabledHover = { background: getComputedStyle(disabled).backgroundColor, matches: disabled.matches('.data-tabs button[aria-selected=true]:hover:not(:disabled)') };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        rest, hovered, disabledHover,
        enabledMatches: enabled.matches('.data-tabs button[aria-selected=true]:not(:disabled)'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.background, 'rgb(239, 244, 246)');
    assert.equal(actual.hovered.background, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.box, actual.hovered.box);
    assert.ok(actual.enabledMatches);
    assert.equal(actual.disabledHover.matches, false);
  });
}
