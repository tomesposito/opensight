import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 22: hover feedback for the standalone Ask O trigger
// button (.q-trigger). A fresh interactive-state audit on the fixture demo
// found the trigger had zero hover feedback in its standalone rendering
// (home sample dashboard, dashboard view): hovering changed nothing, while
// every other landing control already carries a hover state (slices
// 8/16/17/18/20/21). The author-chrome rendering of the same button keeps its
// existing header hover tint via the more specific .author-menu > button:hover
// rule, which wins over this rule in the cascade. The trigger takes the
// established menu-item hover tint (#eaf3f7), same language as the data-page
// buttons and tabs (slices 16/19/21); disabled triggers keep their flat state.
// Background only, so resting geometry is identical. Static (no animation),
// so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.q-trigger:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the Ask O trigger has a hover state using the menu tint', () => {
  assert.ok(hoverRule, 'expected .q-trigger:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#eaf3f7/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected .q-trigger:hover:not(:disabled)');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting trigger rule still reserves the geometry the hover keeps', () => {
  const matches = [...css.matchAll(/([^{}]*\.q-trigger[^{}]*)\{([^}]*)\}/g)]
    .filter(([, selector]) => !selector.includes(':'));
  assert.ok(matches.length, 'expected a non-pseudo .q-trigger rule');
  const resting = matches.find(([, , body]) => /border:\s*1px\s+solid\s+#c9d8de/.test(body));
  assert.ok(resting, 'expected the base rule with the resting border');
  assert.match(resting[2], /background:\s*#fff/);
});

test('the author-chrome button hover rule still outranks the new rule', () => {
  // In the author menu the trigger already takes the header hover tint via
  // .author-workspace[data-chrome] .author-menu > button:hover:not(:disabled),
  // which must keep winning over the standalone rule (no !important anywhere).
  const authorRule = css.match(/\.author-workspace\[data-chrome\]\s+\.author-menu\s*>\s*button:hover:not\(:disabled\)\s*\{([^}]*)\}/);
  assert.ok(authorRule, 'expected the author-chrome menu button hover rule to still exist');
  assert.match(authorRule[1], /background:\s*var\(--header-hover\)/);
  assert.ok(!/!important/.test(hoverRule[1]), 'standalone hover rule must not use !important');
});

describe('Ask O trigger hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="q-entry"><button type="button" class="q-trigger"><span class="o-mark">O</span><span class="q-trigger-label">Ask a question about Local sales</span></button><button type="button" class="q-trigger" disabled><span class="o-mark">O</span><span class="q-trigger-label">Ask a question about Local sales</span></button></div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText === '.q-trigger:hover:not(:disabled)') rules.push(rule);
        }
      }
      const enabled = document.querySelector('.q-entry .q-trigger:not([disabled])');
      const disabled = document.querySelector('.q-entry .q-trigger[disabled]');
      const rest = { background: getComputedStyle(enabled).backgroundColor, box: JSON.stringify(enabled.getBoundingClientRect().toJSON()) };
      // Simulate the matched rule: copy its declarations onto the enabled
      // trigger exactly as the browser cascade would apply them on hover.
      const hover = rules[0];
      for (const prop of hover.style) enabled.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(enabled).backgroundColor, box: JSON.stringify(enabled.getBoundingClientRect().toJSON()) };
      const disabledHover = { background: getComputedStyle(disabled).backgroundColor, box: JSON.stringify(disabled.getBoundingClientRect().toJSON()), matches: disabled.matches('.q-trigger:hover:not(:disabled)') };
      return {
        ruleCount: rules.length,
        // The browser expands the `background` shorthand into longhands; the
        // rule must set only background longhands, with the menu tint color.
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        rest, hovered, disabledHover,
        enabledMatches: enabled.matches('.q-trigger:not(:disabled)'),
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
});
