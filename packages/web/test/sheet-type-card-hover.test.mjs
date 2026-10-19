import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 45: hover feedback for the New Sheet dialog's
// sheet-type selection cards. Slice 44's behavioral dialog audit (real
// mouse hover + computed-style delta, Chromium) measured the enabled
// Interactive sheet card's label flat on hover — a clickable, bordered,
// padded selection card with a pointer cursor that changed nothing —
// while the same dialog's buttons, selects, inputs and textareas all
// tinted (slices 36/37/38/44). The enabled card now takes the author
// hover tint (#edf7f7), with the dark-chrome variant (#334c62) from
// slices 36/37/38/44. The disabled Pixel-Perfect card is excluded: it
// keeps its subtle resting background and not-allowed cursor.
// Background only, so resting geometry is identical; static (no
// animation), so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.sheet-type-card:hover:not\(\.sheet-type-card-disabled\)\s*\{([^}]*)\}/);
const darkRule = css.match(/\.author-workspace\[data-chrome=dark\]\s+\.sheet-type-card:hover:not\(\.sheet-type-card-disabled\)\s*\{([^}]*)\}/);

test('the sheet-type-card hover rules exist in light and dark chrome with the author tints', () => {
  assert.ok(hoverRule, 'expected the .sheet-type-card hover rule');
  assert.match(hoverRule[1], /background:\s*#edf7f7/);
  assert.ok(darkRule, 'expected the dark-chrome .sheet-type-card hover rule');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [hoverRule, darkRule]) {
    assert.ok(rule, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the resting card rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.sheet-type-card\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .sheet-type-card resting rule');
  assert.match(resting[1], /padding:\s*10px 12px/);
  assert.match(resting[1], /border:\s*1px solid var\(--chrome-border, #c9d8de\)/);
  assert.match(resting[1], /cursor:\s*pointer/);
});

test('the disabled card keeps its flat resting state and is excluded from hover', () => {
  const disabled = css.match(/\.sheet-type-card-disabled\s*\{([^}]*)\}/);
  assert.ok(disabled, 'expected the .sheet-type-card-disabled resting rule');
  assert.match(disabled[1], /cursor:\s*not-allowed/);
  assert.match(disabled[1], /background:\s*var\(--chrome-subtle, #f2f6f8\)/);
  assert.ok(hoverRule, 'expected the hover rule to carry the disabled exclusion');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="author-workspace"><dialog class="analysis-file-dialog analysis-settings-dialog" open><form><div class="sheet-type-cards"><label class="sheet-type-card" id="enabled"><input type="radio" checked><span><strong>Interactive sheet</strong></span></label><label class="sheet-type-card sheet-type-card-disabled" id="disabled"><input type="radio" disabled><span><strong>Pixel-Perfect report</strong></span></label></div></form></dialog></div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '').replace(/"/g, '');
          if (sel === '.sheet-type-card:hover:not(.sheet-type-card-disabled)') rules.push(rule);
        }
      }
      const enabled = document.querySelector('#enabled');
      const disabled = document.querySelector('#disabled');
      const rest = { background: getComputedStyle(enabled).backgroundColor, box: JSON.stringify(enabled.getBoundingClientRect().toJSON()) };
      const hover = rules[0];
      for (const prop of hover.style) enabled.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(enabled).backgroundColor, box: JSON.stringify(enabled.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        enabled: { rest, hovered },
        enabledMatches: enabled.matches('.sheet-type-card:not(.sheet-type-card-disabled)'),
        disabledMatches: disabled.matches('.sheet-type-card:not(.sheet-type-card-disabled)'),
        disabledBg: getComputedStyle(disabled).backgroundColor,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(237, 247, 247)');
    assert.equal(actual.enabled.hovered.background, 'rgb(237, 247, 247)');
    assert.notEqual(actual.enabled.rest.background, actual.enabled.hovered.background);
    assert.equal(actual.enabled.rest.box, actual.enabled.hovered.box);
    assert.ok(actual.enabledMatches);
    assert.equal(actual.disabledMatches, false, 'disabled card keeps its flat state');
    assert.equal(actual.disabledBg, 'rgb(242, 246, 248)', 'disabled card keeps its subtle resting background');
  });
}
