import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 51: hover feedback for the account panel's
// Sign out button (.product-header .account-panel button). The button
// renders only in hosted mode (AppNavigation shows it when a hosted
// session can sign out), so the fresh behavioral audits for this slice
// — the author dialogs no prior audit had opened (Analysis Settings,
// Layout Settings, New Sheet, Save as Analysis, Export to PDF,
// Shortcuts help) and the author workspace with every dock panel
// expanded (161 controls) — could never reach it; both expanded-audit
// zero-hover hits were probe artifacts on parked-mouse re-probe. A
// static audit found this primary button (#157f88 background and
// border, white text) had no hover rule on app routes, while primary
// buttons everywhere else darken #157f88 -> #126e76 on hover; on the
// author route the generic .author-workspace button:hover would even
// paint its light #edf7f7 tint under the button's white text. It now
// takes the primary hover step, with the .account-menu segment keeping
// the rule above the author generic hover rules. Background only, so
// resting geometry is identical. Static (no animation), so no
// reduced-motion variant is needed.
const css = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.product-header \.account-menu \.account-panel button:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the account-panel button hover rule exists and uses the primary hover step', () => {
  assert.ok(hoverRule, 'expected the .product-header .account-menu .account-panel button:hover rule');
  assert.match(hoverRule[1], /background:\s*#126e76/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the account-panel button hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting account-panel button rules still reserve the geometry the hover keeps', () => {
  const resting = css.match(/\.product-header \.account-panel button\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .product-header .account-panel button resting rule');
  assert.match(resting[1], /padding:\s*6px 12px/);
  assert.match(resting[1], /min-height:\s*32px/);
  assert.match(resting[1], /border:\s*1px solid #157f88/);
  assert.match(resting[1], /background:\s*#157f88/);
  assert.match(resting[1], /color:\s*#fff/);
});

test('the hover rule outranks the author generic button hover it must not inherit', () => {
  // The generic author rules live in style.css and would otherwise reach
  // this header button on the author route (light tint, and the dark
  // chrome variant). Their selector shapes must stay as they are, and
  // the account-panel rule carries one more class segment than both.
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\)/), 'the author generic button hover rule (slices 36-38) must still be present');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] button:hover:not\(:disabled\)/), 'the author dark generic button hover rule must still be present');
  assert.ok(hoverRule, 'expected the account-panel button hover rule');
  assert.ok(css.match(/\.account-menu summary:hover/), 'the account summary hover rule (slice 17) must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><header class="product-header">
      <details class="account-menu hosted-account" open>
        <summary aria-label="Account"><span class="account-label">Account</span></summary>
        <div class="account-panel"><strong>Hosted workspace</strong><p>Admin</p><button type="button" id="signout">Sign out</button></div>
      </details>
    </header>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '') === '.product-header .account-menu .account-panel button:hover:not(:disabled)') rules.push(rule);
        }
      }
      const button = document.querySelector('#signout');
      const rest = { background: getComputedStyle(button).backgroundColor, box: JSON.stringify(button.getBoundingClientRect().toJSON()) };
      const hover = rules[0];
      if (hover) for (const prop of hover.style) button.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(button).backgroundColor, box: JSON.stringify(button.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        rest,
        hovered,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(18, 110, 118)');
    assert.equal(actual.rest.background, 'rgb(21, 127, 136)');
    assert.equal(actual.hovered.background, 'rgb(18, 110, 118)');
    assert.notEqual(actual.rest.background, actual.hovered.background);
    assert.equal(actual.rest.box, actual.hovered.box);
  });
}
