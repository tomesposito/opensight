import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 37: hover feedback for author-workspace color
// inputs. The author hover rules cover only buttons (line ~318) and selects
// (slice 36), so the color inputs — the Analysis theme palette swatches and
// theme color fields, the formatting and card color pickers — had zero hover
// state: a behavioral audit with every property section expanded (real mouse
// hover, :hover and hit-test confirmed) measured rgb(239,239,239) ->
// rgb(239,239,239) on the palette swatches, the largest real zero-hover class
// left on the author surface (8 inputs). Color inputs now take the author
// buttons' hover language (background #edf7f7 + border #157f88); dark chrome
// takes the dark button hover background (#334c62) via a more specific
// variant. Paint-only: the rules change background and border-color only, so
// resting geometry is identical and there is no animation to need a
// reduced-motion variant.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const lightRule = styleCss.match(/\.author-workspace\s+input\[type=color\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const darkRule = styleCss.match(/\.author-workspace\[data-chrome=dark\]\s+input\[type=color\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('author-workspace color inputs have a hover state with the author button language', () => {
  assert.ok(lightRule, 'expected .author-workspace input[type=color]:hover:not(:disabled)');
  assert.match(lightRule[1], /background:\s*#edf7f7/);
  assert.match(lightRule[1], /border-color:\s*#157f88/);
});

test('dark chrome color inputs take the dark button hover background', () => {
  assert.ok(darkRule, 'expected .author-workspace[data-chrome=dark] input[type=color]:hover:not(:disabled)');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the color-input hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [lightRule, darkRule]) {
    assert.ok(rule, 'expected both hover rules');
    assert.ok(!/padding|margin|border-width|width|height|font|box-shadow/.test(rule[1]), 'hover must change background/border-color only');
  }
});

test('the resting color-input sizing rules are preserved', () => {
  const swatches = styleCss.match(/\.color-inputs\s+input\[type=color\]\s*\{([^}]*)\}/);
  assert.ok(swatches, 'expected the .color-inputs swatch sizing rule to remain');
  assert.match(swatches[1], /height:\s*30px/);
  const fields = styleCss.match(/\.property-section\s+input\[type=color\]\s*\{([^}]*)\}/);
  assert.ok(fields, 'expected the .property-section color field rule to remain');
  assert.match(fields[1], /height:\s*34px/);
});

describe('author color-input hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${styleCss}</style>`
      + `<div class="author-workspace"><div class="color-inputs"><label>Color 1`
      + `<input type="color" id="c" value="#157f88"></label></div></div>`);
    const actual = await page.evaluate(() => {
      const find = text => {
        const hits = [];
        for (const s of document.styleSheets) for (const r of s.cssRules) if (r.selectorText?.replaceAll('"', '') === text) hits.push(r);
        return hits;
      };
      const el = document.querySelector('#c');
      const rules = find('.author-workspace input[type=color]:hover:not(:disabled)');
      const rest = { background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      for (const prop of rules[0].style) el.style.setProperty(prop, rules[0].style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      return { ruleCount: rules.length, rest, hovered };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.rest.background, 'rgb(239, 239, 239)');
    assert.equal(actual.hovered.background, 'rgb(237, 247, 247)');
    assert.equal(actual.hovered.border, 'rgb(21, 127, 136)');
    assert.equal(actual.rest.box, actual.hovered.box);
  });
});
