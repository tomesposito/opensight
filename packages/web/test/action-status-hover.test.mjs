import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 61: hover feedback for the Dashboard's
// .action-status bar ("Reset actions" button in Dashboard.tsx). Static
// audit follow-on to slices 57/59/60: the bar renders in <main> inside
// .app-shell, outside .author-workspace, .data-page, .collection-card and
// .admin-settings, so no :hover rule in any stylesheet reached its button
// — its only rule (.action-status, .drill-navigation) sets layout — and
// hovering changed nothing while buttons on every other surface tint.
// The button now takes #edf7f7 — style.css's generic button hover tint
// (.author-workspace button:hover, the slice-60 .job-management button).
// The Author instance of .action-status already takes the same tint from
// the author rule, which also sets its border-color and whose dark-chrome
// variant has higher specificity, so it is unchanged in effect.
// Background only, so resting geometry is identical. Static (no
// animation), so no reduced-motion variant is needed; the disabled state
// (no active selection) keeps its flat resting state.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const buttonHover = css.match(/\.action-status button:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the action-status button hover rule exists with the app tint', () => {
  assert.ok(buttonHover, 'expected the action-status button hover rule');
  assert.match(buttonHover[1], /background:\s*#edf7f7/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(buttonHover, 'expected the action-status button hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(buttonHover[1]), 'hover must change background only');
});

test('the resting action-status layout rule is preserved', () => {
  const bar = css.match(/\.action-status, \.drill-navigation\s*\{([^}]*)\}/);
  assert.ok(bar, 'expected the action-status resting layout rule');
  assert.match(bar[1], /display:\s*flex/);
  assert.match(bar[1], /align-items:\s*center/);
});

test('the author and job-management hover rules are untouched', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#edf7f7/), 'the author button hover rule must still be present');
  assert.ok(css.match(/\.job-management button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the job-management button hover rule must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="action-status">
      <button id="reset" type="button">Reset actions</button><span role="status">1 active selection(s)</span>
      <button id="off" type="button" disabled>Reset actions</button>
    </div>`);
    const actual = await page.evaluate(() => {
      let found;
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '') === '.action-status button:hover:not(:disabled)') found = rule;
        }
      }
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const off = document.querySelector('#off');
      return {
        reset: found ? measure(document.querySelector('#reset'), found) : null,
        offMatches: found ? off.matches(found.selectorText.replace(':hover', '')) : null,
      };
    });
    assert.ok(actual.reset, 'expected the button hover rule in the CSSOM');
    assert.equal(actual.reset.rest.background, 'rgb(239, 239, 239)', 'reset rest');
    assert.equal(actual.reset.hovered.background, 'rgb(237, 247, 247)', 'reset hover');
    assert.equal(actual.reset.rest.box, actual.reset.hovered.box, 'reset geometry');
    assert.equal(actual.offMatches, false, 'disabled buttons must be excluded from the hover rule');
  });
}
