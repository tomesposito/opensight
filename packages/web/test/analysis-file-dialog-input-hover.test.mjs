import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 44: hover feedback for the analysis file
// dialogs' text inputs and textareas. Route audits never open a dialog,
// so these fields were never measured before: a behavioral audit that
// opens the New Sheet and Analysis Settings dialogs in Chromium (real
// mouse hover + computed-style delta) found the Sheet name input
// (430x28), the Analysis name input (430x28) and the Description
// textarea (430x64) measured white -> white, while the same dialogs'
// buttons and selects tinted via the author-workspace hover rules. The
// author input hover rules cover only [type=search] (slice 38) and
// [type=color] (slice 37); the dialogs' text inputs and textareas were
// the unfinished members. They now take the author buttons' hover tint
// (#edf7f7), with the dark-chrome variant (#334c62) from slices
// 36/37/38. Radio and checkbox inputs keep their native rendering.
// Background only, so resting geometry is identical; static (no
// animation), so no reduced-motion variant is needed.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.analysis-file-dialog\s+input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\),\s*\.analysis-file-dialog\s+textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const darkRule = css.match(/\.author-workspace\[data-chrome=dark\]\s+\.analysis-file-dialog\s+input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\),\s*\.author-workspace\[data-chrome=dark\]\s+\.analysis-file-dialog\s+textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the dialog input/textarea hover rules exist in light and dark chrome with the author tints', () => {
  assert.ok(hoverRule, 'expected the .analysis-file-dialog input/textarea hover rule');
  assert.match(hoverRule[1], /background:\s*#edf7f7/);
  assert.ok(darkRule, 'expected the dark-chrome .analysis-file-dialog input/textarea hover rule');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [hoverRule, darkRule]) {
    assert.ok(rule, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the resting dialog input rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.analysis-file-dialog input \{([^}]*)\}/);
  assert.ok(resting, 'expected the .analysis-file-dialog input resting rule');
  assert.match(resting[1], /background:\s*var\(--chrome-surface, #fff\)/);
  assert.match(resting[1], /border:\s*1px solid var\(--chrome-border, #c9d8de\)/);
  assert.match(resting[1], /padding:\s*4px 8px/);
});

test('the dialog input/textarea hover coexists with the dialog button and select hovers', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\),\s*\.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author button hover rule must still be present');
  assert.ok(css.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-36 author select hover rule must still be present');
  assert.ok(css.match(/\.author-workspace input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-38 author search-input hover rule must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="author-workspace"><dialog class="analysis-file-dialog analysis-settings-dialog" open><form><label>Sheet name<input id="name" value="Sheet 2"></label><label>Description<textarea id="desc" rows="3">notes</textarea></label><label class="sheet-type-card"><input id="radio" type="radio" checked><span>Interactive sheet</span></label><label>Locked<input id="locked" disabled value="x"></label></form></dialog></div><input id="outside" value="outside">`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '').replace(/"/g, '');
          if (sel === '.analysis-file-dialog input:hover:not(:disabled):not([type=radio]):not([type=checkbox]), .analysis-file-dialog textarea:hover:not(:disabled)') rules.push(rule);
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
      const desc = document.querySelector('#desc');
      const radio = document.querySelector('#radio');
      const locked = document.querySelector('#locked');
      const outside = document.querySelector('#outside');
      const fieldSel = '.analysis-file-dialog input:not(:disabled):not([type=radio]):not([type=checkbox])';
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        name: measure(name),
        desc: measure(desc),
        outsideBg: getComputedStyle(outside).backgroundColor,
        nameMatches: name.matches(fieldSel),
        descMatches: desc.matches('.analysis-file-dialog textarea:not(:disabled)'),
        radioMatches: radio.matches(fieldSel),
        disabledMatches: locked.matches(fieldSel),
        outsideMatches: outside.matches(fieldSel),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(237, 247, 247)');
    for (const key of ['name', 'desc']) {
      assert.equal(actual[key].rest.background, 'rgb(255, 255, 255)', key);
      assert.equal(actual[key].hovered.background, 'rgb(237, 247, 247)', key);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, key + ' text color must not change');
      assert.equal(actual[key].rest.box, actual[key].hovered.box, key);
    }
    assert.ok(actual.nameMatches);
    assert.ok(actual.descMatches);
    assert.equal(actual.radioMatches, false, 'radio inputs keep their native rendering');
    assert.equal(actual.disabledMatches, false, 'disabled inputs keep their flat state');
    assert.equal(actual.outsideMatches, false, 'inputs outside the dialog keep their own states');
  });
}
