import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 54: hover feedback for the embed surface
// fields (.embed-question / .embed-author input and select, and the
// .embed-preview-controls select). Slice 53 gave the embed buttons a
// hover step and noted the fields were left: embed.css carried no
// field :hover rules at all — the Question input, the embedded
// author's name input and its Dataset/Visual type/Group by/Value/
// Aggregation selects, and the preview's Branding/Palette selects all
// rest at #fff, but hovering changed nothing, while the buttons beside
// them tint. The fields now take #edf2fa on hover — the embed
// surface's own tint (--embed-tint on .embed-frame, the state-symbol
// background). Background only, so resting geometry is identical.
// Static (no animation), so no reduced-motion variant is needed.
// Disabled fields are excluded and keep their flat resting state.
const css = await readFile(new URL('../src/embed.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.embed-question input:hover:not\(:disabled\),\.embed-author input:hover:not\(:disabled\),\.embed-author select:hover:not\(:disabled\),\.embed-preview-controls select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the embed field hover rule exists for all four embed field contexts', () => {
  assert.ok(hoverRule, 'expected the grouped embed field hover rule');
  assert.match(hoverRule[1], /background:\s*#edf2fa/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the embed field hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting field rules still reserve the geometry the hover keeps', () => {
  const rest = css.match(/\.embed-question input,\.embed-author input,\.embed-author select\s*\{([^}]*)\}/);
  assert.ok(rest, 'expected the embed question/author field resting rule');
  assert.match(rest[1], /padding:\s*9px/);
  assert.match(rest[1], /border:\s*1px solid #bac6d3/);
  assert.match(rest[1], /background:\s*#fff/);
  const preview = css.match(/\.embed-preview-controls select\s*\{([^}]*)\}/);
  assert.ok(preview, 'expected the embed preview select resting rule');
  assert.match(preview[1], /border:\s*1px solid #b6c2d3/);
  assert.match(preview[1], /padding:\s*8px 28px 8px 12px/);
  assert.match(preview[1], /background:\s*#fff/);
});

test('the hover step coexists with the embed button hover rule and theme vars', () => {
  assert.ok(css.match(/\.embed-frame\s*\{[^}]*--embed-tint:\s*#edf2fa/), 'the embed tint var must still be present');
  assert.ok(css.match(/\.embed-state button:hover:not\(:disabled\),\.embed-question button:hover:not\(:disabled\),\.embed-author button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#d4dfe7/), 'the slice-53 embed button hover rule must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="embed-frame"><section class="embed-question">
      <label>Question<input id="q" type="text" value="total by region"></label>
    </section><section class="embed-author"><aside>
      <label>Dataset<select id="ds"><option>sales</option></select></label>
      <label>Locked<select id="locked" disabled><option>sales</option></select></label>
    </aside></section></div><main class="embed-preview"><div class="embed-preview-controls">
      <label>Branding<select id="brand"><option>OpenSight default</option></select></label>
    </div></main>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '').includes('.embed-question input:hover')) rules.push(rule);
        }
      }
      const measure = (id) => {
        const el = document.querySelector(id);
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        const hover = rules[0];
        if (hover) { for (const prop of hover.style) el.style.setProperty(prop, hover.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      const locked = document.querySelector('#locked');
      return {
        ruleCount: rules.length,
        backgroundValue: rules.length ? rules[0].style.getPropertyValue('background') : null,
        q: measure('#q'),
        ds: measure('#ds'),
        brand: measure('#brand'),
        lockedMatches: rules.length ? locked.matches(rules[0].selectorText.split(',')[2].replace(':hover', '')) : null,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.backgroundValue, 'rgb(237, 242, 250)');
    for (const key of ['q', 'ds', 'brand']) {
      assert.equal(actual[key].rest.background, 'rgb(255, 255, 255)', key);
      assert.equal(actual[key].hovered.background, 'rgb(237, 242, 250)', key);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background, key);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, key);
    }
    assert.equal(actual.lockedMatches, false, 'disabled selects must be excluded from the field hover rule');
  });
}
