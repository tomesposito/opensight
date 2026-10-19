import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 36: hover feedback for author-workspace selects.
// The author hover rule covers only buttons, so the Properties panel's
// selects (the Analysis theme palette picker, the font-family picker, and
// every other select on the author surface) had zero hover state: a
// behavioral audit with the Analysis theme section expanded (real mouse
// hover, :hover confirmed applied) measured white -> white on the palette
// select while the buttons beside it tinted. Selects now take the author
// buttons' hover tint (#edf7f7); dark chrome takes the dark button hover
// (#334c62) via a more specific variant. Paint-only: the rules change the
// background, so resting geometry is identical and there is no animation
// to need a reduced-motion variant.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const lightRule = styleCss.match(/\.author-workspace\s+select:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const darkRule = styleCss.match(/\.author-workspace\[data-chrome=dark\]\s+select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('author-workspace selects have a hover state with the author button tint', () => {
  assert.ok(lightRule, 'expected .author-workspace select:hover:not(:disabled)');
  assert.match(lightRule[1], /background:\s*#edf7f7/);
});

test('dark chrome selects take the dark button hover tint', () => {
  assert.ok(darkRule, 'expected .author-workspace[data-chrome=dark] select:hover:not(:disabled)');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the select hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [lightRule, darkRule]) {
    assert.ok(rule, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(rule[1]), 'hover must change background only');
  }
});

test('the chrome-switch select keeps its own more specific header hover', () => {
  const chromeSwitch = styleCss.match(/\.author-workspace\[data-chrome\]\s+\.chrome-switch\s+select:hover\s*\{([^}]*)\}/);
  assert.ok(chromeSwitch, 'expected the chrome-switch select hover rule to remain');
  assert.match(chromeSwitch[1], /background:\s*var\(--header-pressed\)/);
});

describe('author select hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${styleCss}</style>`
      + `<div class="author-workspace"><label>Palette `
      + `<select id="s"><option>coastal</option><option>vivid</option></select></label></div>`);
    const actual = await page.evaluate(() => {
      const find = text => {
        const hits = [];
        for (const s of document.styleSheets) for (const r of s.cssRules) if (r.selectorText === text) hits.push(r);
        return hits;
      };
      const el = document.querySelector('#s');
      const rules = find('.author-workspace select:hover:not(:disabled)');
      const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      for (const prop of rules[0].style) el.style.setProperty(prop, rules[0].style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
      return { ruleCount: rules.length, rest, hovered };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.hovered.background, 'rgb(237, 247, 247)');
    assert.equal(actual.rest.box, actual.hovered.box);
  });
});
