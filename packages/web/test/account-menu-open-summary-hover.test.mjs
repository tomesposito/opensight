import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 80: hover feedback for the product
// header's OPEN account-menu summary (.account-menu[open] summary
// in AppNavigation.tsx — the Account disclosure, on every app
// route). Its [open] rule paints the exact tint the slice-17 hover
// rule paints (#365764), ties it at (0,2,1) and stands after it, so
// hovering the open summary changed nothing, while every closed
// summary steps transparent -> #365764. Slice 17 made the closed
// hover preview the open state; slices 73-79 since established
// that selected/open controls take a dedicated hover step beyond
// their selected rest (slice 79 did this for the author menu's
// open summary). The open summary now steps one step deeper:
// #254a5e, already in the palette as the dark control hover step
// (.back-to-top:hover in style.css, resting at #19384a) and the
// middle step of the dark-teal sequence #162e40 (header) ->
// #254a5e -> #365764, so no new colour is introduced. Background
// only, so the summary's #526c7a border, white text and resting
// geometry are identical; static (no animation), so no
// reduced-motion variant.
const css = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const rule = css.match(/\.account-menu\[open\] summary:hover\s*\{([^}]*)\}/);

test('the open account-menu summary hover rule exists and uses the deeper dark-teal step', () => {
  assert.ok(rule, 'expected the .account-menu[open] summary:hover rule');
  assert.match(rule[1], /background:\s*#254a5e/);
});

test('the hover tint is the established dark-control hover step, distinct from the open rest tint', () => {
  assert.ok(styleCss.match(/\.back-to-top:hover\s*\{\s*background:\s*#254a5e/), 'the back-to-top hover step must remain #254a5e');
  const open = css.match(/\.account-menu\[open\] summary\s*\{([^}]*)\}/);
  assert.ok(open, 'expected the .account-menu[open] summary resting rule');
  assert.match(open[1], /background:\s*#365764/);
  assert.notEqual('#254a5e', '#365764', 'the hover tint must differ from the resting tint');
});

test('the open-summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting account-menu summary rules are preserved', () => {
  const hover = css.match(/\.account-menu summary:hover\s*\{([^}]*)\}/);
  assert.ok(hover, 'expected the slice-17 closed summary hover rule');
  assert.match(hover[1], /background:\s*#365764/);
  const open = css.match(/\.account-menu\[open\] summary\s*\{([^}]*)\}/);
  assert.ok(open, 'expected the .account-menu[open] summary rule to remain');
  assert.match(open[1], /background:\s*#365764/);
  const summary = css.match(/\.account-menu summary\s*\{([^}]*)\}/);
  assert.ok(summary, 'expected the account summary layout rule');
  assert.match(summary[1], /border:\s*1px solid #526c7a/);
});

test('the neighbouring header hover rules are untouched', () => {
  assert.ok(css.match(/\.product-header \.brand:hover\s*\{\s*background:\s*#365764/), 'the brand hover must remain #365764');
  assert.ok(css.match(/\.product-header \.account-menu \.account-panel button:hover:not\(:disabled\)\s*\{\s*background:\s*#126e76/), 'the slice-51 account-panel Sign out hover must remain #126e76');
  assert.ok(css.match(/\.product-header \.fixture-picker select:hover:not\(:disabled\)\s*\{\s*background:\s*#365764/), 'the slice-33 fixture-picker hover must remain #365764');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><header class="product-header">
      <details class="account-menu hosted-account" id="open-menu" open>
        <summary id="open-summary">Account</summary>
        <div class="account-panel"><p>Local workspace</p></div>
      </details>
      <details class="account-menu" id="closed-menu">
        <summary id="closed-summary">Account</summary>
      </details>
      <details id="outside-menu" open>
        <summary id="outside-summary">Other</summary>
      </details>
    </header>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '') === '.account-menu[open] summary:hover') rules.push(rule);
        }
      }
      const open = document.querySelector('#open-summary');
      const closed = document.querySelector('#closed-summary');
      const outside = document.querySelector('#outside-summary');
      const rest = { background: getComputedStyle(open).backgroundColor, border: getComputedStyle(open).borderTopColor, box: JSON.stringify(open.getBoundingClientRect().toJSON()) };
      const hover = rules[0];
      if (hover) for (const prop of hover.style) open.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(open).backgroundColor, border: getComputedStyle(open).borderTopColor, box: JSON.stringify(open.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        open: { rest, hovered },
        openMatches: open.matches('.account-menu[open] summary'),
        closedMatches: closed.matches('.account-menu[open] summary'),
        outsideMatches: outside.matches('.account-menu[open] summary'),
        closedBg: getComputedStyle(closed).backgroundColor,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(37, 74, 94)');
    assert.equal(actual.open.rest.background, 'rgb(54, 87, 100)');
    assert.equal(actual.open.hovered.background, 'rgb(37, 74, 94)');
    assert.notEqual(actual.open.rest.background, actual.open.hovered.background);
    assert.equal(actual.open.rest.border, actual.open.hovered.border, 'the #526c7a border must be unchanged');
    assert.equal(actual.open.rest.box, actual.open.hovered.box);
    assert.ok(actual.openMatches);
    assert.equal(actual.closedMatches, false, 'a closed account summary keeps the slice-17 hover rule');
    assert.equal(actual.outsideMatches, false, 'an open summary outside the account menu is out of scope');
    assert.equal(actual.closedBg, 'rgba(0, 0, 0, 0)', 'closed summary resting state unchanged');
  });
}
