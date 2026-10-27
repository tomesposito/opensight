import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

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
const css = styles['app-chrome.css'];
const styleCss = styles['style.css'];

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

defineHoverCases('account-menu-open-summary hover', {
  html: `<header class="product-header">
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
    </header>`,
  cases: [
    {
      target: '#open-summary',
      rule: '.account-menu[open] summary:hover',
      resting: { backgroundColor: 'rgb(54, 87, 100)' },
      hovered: { backgroundColor: 'rgb(37, 74, 94)' },
      paintOnly: true,
      unchanged: ['borderTopColor'],
      excluded: [{ target: '#closed-summary', resting: { backgroundColor: 'rgba(0, 0, 0, 0)' } }, '#outside-summary'],
    },
  ],
});
