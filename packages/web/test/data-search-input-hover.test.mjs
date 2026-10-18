import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 27: hover feedback for the Data landing's dataset
// search input. A fresh interactive-state audit of the landing surfaces
// (home/my-stuff/analyses/dashboards/data, in-page CLS at 0 on every route,
// no page errors) found the search input was the last interactive control on
// the landing surfaces with zero hover state: hovering it changed nothing,
// while the surrounding buttons, tabs, and the filter select already take the
// data page's established menu-item hover tint (#eaf3f7, slices 16/21). The
// input takes the same tint; disabled inputs keep their flat state. Background
// only, so resting geometry is identical. Static (no animation), so no
// reduced-motion variant is needed.
const css = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.data-page\s+input\[type=search\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the data-page search input has a hover state using the menu tint', () => {
  assert.ok(hoverRule, 'expected .data-page input[type=search]:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected .data-page input[type=search]:hover:not(:disabled)');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting search-input rule still reserves the geometry the hover keeps', () => {
  const matches = [...css.matchAll(/([^{}]*\.data-page\s+input[^{}]*)\{([^}]*)\}/g)]
    .filter(([, selector]) => !selector.includes(':'));
  assert.ok(matches.length, 'expected a non-pseudo .data-page input rule');
  const resting = matches.find(([, , body]) => /border:\s*1px\s+solid\s+#9eb0ba/.test(body));
  assert.ok(resting, 'expected the base rule with the resting border');
  assert.match(resting[2], /background:\s*white/);
});

test('the data-page search input hover rule coexists with the filter select rule', () => {
  assert.ok(css.match(/\.data-page\s+select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'slice-21 filter select rule must still be present');
  assert.ok(hoverRule, 'expected .data-page input[type=search]:hover:not(:disabled)');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><section class="data-page"><div class="data-tools"><input type="search" aria-label="Search datasets by name" placeholder="Search datasets by name"><input type="search" aria-label="Disabled search" disabled></div></section>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          // Browsers normalize attribute selectors to quoted form
          // (input[type="search"]), so compare with quotes stripped.
          if ((rule.selectorText || '').replace(/"/g, '') === '.data-page input[type=search]:hover:not(:disabled)') rules.push(rule);
        }
      }
      const enabled = document.querySelector('.data-page input:not([disabled])');
      const disabled = document.querySelector('.data-page input[disabled]');
      const rest = { background: getComputedStyle(enabled).backgroundColor, box: JSON.stringify(enabled.getBoundingClientRect().toJSON()) };
      // Simulate the matched rule: copy its declarations onto the enabled
      // input exactly as the browser cascade would apply them on hover.
      const hover = rules[0];
      for (const prop of hover.style) enabled.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(enabled).backgroundColor, box: JSON.stringify(enabled.getBoundingClientRect().toJSON()) };
      const disabledHover = { background: getComputedStyle(disabled).backgroundColor, matches: disabled.matches('.data-page input[type=search]:hover:not(:disabled)') };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        rest, hovered, disabledHover,
        enabledMatches: enabled.matches('.data-page input[type=search]:not(:disabled)'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.hovered.background, 'rgb(234, 243, 247)');
    assert.equal(actual.rest.box, actual.hovered.box);
    assert.ok(actual.enabledMatches);
    assert.equal(actual.disabledHover.matches, false);
    assert.equal(actual.disabledHover.background, 'rgb(255, 255, 255)');
  });
}
