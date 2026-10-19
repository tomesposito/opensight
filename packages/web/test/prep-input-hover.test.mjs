import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 39: hover feedback for the data-prep inputs and
// textareas. A fresh behavioral hover audit of the preparation surface
// (real mouse hover + computed-style delta, Chromium, demo route) found
// the document-bar dataset-name input (280x28) and the steps-panel
// "Search steps" input (183x30) measured white -> white: the surface
// gives its buttons (and, since slice 31, its selects) a hover tint, but
// inputs and textareas — the remaining members of the resting-rule group
// (.data-prep input, .data-prep select, .data-prep textarea) — had none.
// The step editors' text inputs and expression/values textareas share the
// same resting rule and the same gap. They now take the surface's own
// hover tint (#edf6fc). Background only, so resting geometry is
// identical; disabled fields keep their flat state. Static (no
// animation), so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.data-prep\s+input:hover:not\(:disabled\),\s*\.data-prep\s+textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the prep input/textarea hover rule exists and uses the data-prep hover tint', () => {
  assert.ok(hoverRule, 'expected .data-prep input:hover:not(:disabled), .data-prep textarea:hover:not(:disabled)');
  assert.match(hoverRule[1], /background:\s*#edf6fc/);
});

test('the hover preview is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the prep input/textarea hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting prep input/select/textarea rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.data-prep input, \.data-prep select, \.data-prep textarea \{([^}]*)\}/);
  assert.ok(resting, 'expected the shared .data-prep input/select/textarea resting rule');
  assert.match(resting[1], /background:\s*white/);
  assert.match(resting[1], /border:\s*1px solid #aebdca/);
  assert.match(resting[1], /padding:\s*7px/);
});

test('the prep input/textarea hover rule coexists with the prep button and select hover rules', () => {
  assert.ok(css.match(/\.data-prep\s+button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep button hover rule must still be present');
  assert.ok(css.match(/\.data-prep\s+select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the slice-31 data-prep select hover rule must still be present');
  assert.ok(hoverRule, 'expected the prep input/textarea hover rule');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="data-prep"><div class="prep-document-bar"><label>Dataset name<input id="name" value="demo"></label></div><div class="prep-sidebar"><label class="prep-steps-search">Search steps<input id="search" type="search" placeholder="Search steps"></label></div><label>Expression<textarea id="expr" rows="3">{revenue}</textarea></label><label>Locked<input id="locked" disabled value="x"></label></div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '').replace(/"/g, '');
          if (sel === '.data-prep input:hover:not(:disabled), .data-prep textarea:hover:not(:disabled)') rules.push(rule);
        }
      }
      const measure = el => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        const hover = rules[0];
        for (const prop of hover.style) el.style.setProperty(prop, hover.style.getPropertyValue(prop));
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      const name = document.querySelector('#name');
      const search = document.querySelector('#search');
      const expr = document.querySelector('#expr');
      const locked = document.querySelector('#locked');
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        name: measure(name),
        search: measure(search),
        expr: measure(expr),
        nameMatches: name.matches('.data-prep input:not(:disabled)'),
        exprMatches: expr.matches('.data-prep textarea:not(:disabled)'),
        disabledMatches: locked.matches('.data-prep input:not(:disabled)'),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(237, 246, 252)');
    for (const key of ['name', 'search', 'expr']) {
      assert.equal(actual[key].rest.background, 'rgb(255, 255, 255)', key);
      assert.equal(actual[key].hovered.background, 'rgb(237, 246, 252)', key);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, key + ' text color must not change');
      assert.equal(actual[key].rest.box, actual[key].hovered.box, key);
    }
    assert.ok(actual.nameMatches);
    assert.ok(actual.exprMatches);
    assert.equal(actual.disabledMatches, false, 'disabled inputs keep their flat state');
  });
}
