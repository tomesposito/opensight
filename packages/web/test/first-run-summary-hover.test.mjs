import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 70: hover feedback for the first-run page's
// "Required API environment variables" disclosure summary (.first-run
// summary in FirstRun.tsx, inside .first-run-setup). Every other
// first-run control hovers to the surface tint (#eaf3f4): its buttons
// via .first-run button:hover and its docs links via slice 63. A
// summary is neither a button nor a link, and every summary:hover rule
// in the cascade is scoped elsewhere (.author-workspace, .prep-*,
// .calculation-dialog, .card-footer, .account-menu, .data-*), so no
// hover rule reached this one — its only rules gave font weight, line
// height and the global cursor/:active press — and hovering it changed
// nothing while every other control on the page tinted. The page is
// standalone (SessionGate renders it before any session, outside
// .app-shell), so no app-shell rule reaches it either. It now takes
// the first-run surface's own hover tint (#eaf3f4). Background only,
// so resting geometry is identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const rule = styleCss.match(/\.first-run\s+summary:hover\s*\{([^}]*)\}/);

test('the first-run summary has a hover state with the surface tint', () => {
  assert.ok(rule, 'expected the .first-run summary hover rule');
  assert.match(rule[1], /background:\s*#eaf3f4/);
});

test('the summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting first-run summary rules are preserved', () => {
  assert.ok(styleCss.match(/\.first-run summary\s*\{[^}]*font-weight:\s*650; line-height:\s*1\.6/), 'the summary resting rule must remain');
  assert.ok(styleCss.match(/\.first-run details\s*\{[^}]*border-top:\s*1px solid #d1e0e5/), 'the details resting rule must remain');
});

test('the neighbouring first-run hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.first-run button:hover:not\(:disabled\), \.fixture-demo-banner button:hover\s*\{[^}]*background:\s*#eaf3f4/), 'the first-run button hover must remain');
  assert.ok(styleCss.match(/\.first-run \.first-run-primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#0d5960/), 'the first-run primary hover must remain');
  assert.ok(styleCss.match(/\.first-run-docs a:hover\s*\{[^}]*background:\s*#eaf3f4/), 'slice 63 docs-link hover must remain');
});

describe('first-run summary hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${styleCss}</style>`
      + `<div class="first-run"><main class="first-run-main"><div class="first-run-paths"><section class="first-run-setup"><details><summary id="s">Required API environment variables</summary></details></section></div></main></div>`
      + `<details><summary id="outside">Outside summary</summary></details>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.first-run summary:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const matches = (el, rule) => rule ? el.matches(rule.selectorText.replaceAll(':hover', '')) : null;
      return {
        found: !!found,
        s: found ? measure(document.querySelector('#s'), found) : null,
        outsideMatches: matches(document.querySelector('#outside'), found),
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.equal(actual.s.rest.background, 'rgba(0, 0, 0, 0)', 'summary rest');
    assert.equal(actual.s.hovered.background, 'rgb(234, 243, 244)', 'summary hover');
    assert.equal(actual.s.rest.box, actual.s.hovered.box, 'summary geometry');
    assert.equal(actual.outsideMatches, false, 'a summary outside .first-run must be out of scope');
  });
});
