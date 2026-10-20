import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 60: hover feedback for the hosted Jobs page
// (.job-management in JobManagement.tsx — "Refresh jobs and history" and
// the per-row "History {id}" / "Run {id}" buttons). Static audit follow-on
// to slices 57/59: the page renders in <main> inside .app-shell, outside
// .author-workspace, .data-page, .collection-card and .admin-settings, so
// no :hover rule in any stylesheet reached its buttons — its only button
// rule set white-space/overflow-wrap — and hovering changed nothing while
// buttons on every other surface tint. The buttons now take #edf7f7 —
// style.css's generic button hover tint (.author-workspace button:hover,
// the slice-59 .admin-settings buttons). Background only, so resting
// geometry is identical. Static (no animation), so no reduced-motion
// variant is needed; disabled buttons (the page's busy state) keep their
// flat resting state.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const buttonHover = css.match(/\.job-management button:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the job-management button hover rule exists with the app tint', () => {
  assert.ok(buttonHover, 'expected the job-management button hover rule');
  assert.match(buttonHover[1], /background:\s*#edf7f7/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(buttonHover, 'expected the job-management button hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(buttonHover[1]), 'hover must change background only');
});

test('the resting job-management button rule still reserves the wrapping the hover keeps', () => {
  const button = css.match(/\.job-management button\s*\{([^}]*)\}/);
  assert.ok(button, 'expected the job-management button resting rule');
  assert.match(button[1], /white-space:\s*normal/);
  assert.match(button[1], /overflow-wrap:\s*anywhere/);
});

test('the author and admin hover rules are untouched', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#edf7f7/), 'the author button hover rule must still be present');
  assert.ok(css.match(/\.admin-settings button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the admin-settings button hover rule must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><section class="job-management">
      <button id="refresh" type="button">Refresh jobs and history</button>
      <table><tbody><tr><td>job-1</td><td><button id="history" type="button">History job-1</button><button id="run" type="button">Run job-1</button><button id="off" type="button" disabled>History job-2</button></td></tr></tbody></table>
    </section>`);
    const actual = await page.evaluate(() => {
      let found;
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '') === '.job-management button:hover:not(:disabled)') found = rule;
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
        refresh: found ? measure(document.querySelector('#refresh'), found) : null,
        history: found ? measure(document.querySelector('#history'), found) : null,
        run: found ? measure(document.querySelector('#run'), found) : null,
        offMatches: found ? off.matches(found.selectorText.replace(':hover', '')) : null,
      };
    });
    assert.ok(actual.refresh, 'expected the button hover rule in the CSSOM');
    for (const key of ['refresh', 'history', 'run']) {
      assert.equal(actual[key].rest.background, 'rgb(239, 239, 239)', `${key} rest`);
      assert.equal(actual[key].hovered.background, 'rgb(237, 247, 247)', `${key} hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} geometry`);
    }
    assert.equal(actual.offMatches, false, 'disabled buttons must be excluded from the hover rule');
  });
}
