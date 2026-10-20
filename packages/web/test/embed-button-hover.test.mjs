import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 53: hover feedback for the embed surface
// buttons (.embed-state / .embed-question / .embed-author button).
// embed.css carried no :hover rules at all: the embed buttons rest at
// #eef3f8 with cursor:pointer, but hovering changed nothing, while
// every other surface in the app gives its buttons a hover step. The
// buttons now take #d4dfe7 on hover — the codebase's existing
// blue-gray hover step (.fixture-notice a:hover in style.css).
// Background only, so resting geometry is identical. Static (no
// animation), so no reduced-motion variant is needed. Disabled
// buttons are excluded and keep their flat resting state.
const css = await readFile(new URL('../src/embed.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.embed-state button:hover:not\(:disabled\),\.embed-question button:hover:not\(:disabled\),\.embed-author button:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the embed button hover rule exists for all three embed contexts', () => {
  assert.ok(hoverRule, 'expected the grouped embed button hover rule');
  assert.match(hoverRule[1], /background:\s*#d4dfe7/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the embed button hover rule');
  assert.ok(!/padding|margin|border|width|height|font-size|box-shadow/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting button rule still reserves the geometry the hover keeps', () => {
  const rest = css.match(/\.embed-state button,\.embed-question button,\.embed-author button\s*\{([^}]*)\}/);
  assert.ok(rest, 'expected the embed button resting rule');
  assert.match(rest[1], /padding:\s*9px 14px/);
  assert.match(rest[1], /border:\s*1px solid #bac6d3/);
  assert.match(rest[1], /cursor:\s*pointer/);
  assert.match(rest[1], /background:\s*#eef3f8/);
});

test('the hover step coexists with the embed theme vars and resting rules', () => {
  assert.ok(css.match(/\.embed-frame\s*\{[^}]*--embed-tint:\s*#edf2fa/), 'the embed tint var must still be present');
  assert.ok(css.match(/\.embed-question input,\.embed-author input,\.embed-author select\s*\{/), 'the embed field resting rule must still be present');
  assert.ok(css.match(/\.embed-preview-controls select\s*\{/), 'the embed preview select resting rule must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="embed-frame"><div class="embed-state">
      <button id="btn" type="button">Try again</button>
    </div></div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '').includes('.embed-state button:hover')) rules.push(rule);
        }
      }
      const btn = document.querySelector('#btn');
      const rest = { background: getComputedStyle(btn).backgroundColor, box: JSON.stringify(btn.getBoundingClientRect().toJSON()) };
      const hover = rules[0];
      if (hover) btn.style.cssText = hover.style.cssText;
      const hovered = { background: getComputedStyle(btn).backgroundColor, box: JSON.stringify(btn.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        backgroundValue: rules.length ? rules[0].style.getPropertyValue('background') : null,
        rest,
        hovered,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.backgroundValue, 'rgb(212, 223, 231)');
    assert.equal(actual.rest.background, 'rgb(238, 243, 248)');
    assert.equal(actual.hovered.background, 'rgb(212, 223, 231)');
    assert.notEqual(actual.rest.background, actual.hovered.background);
    assert.equal(actual.rest.box, actual.hovered.box);
  });
}
