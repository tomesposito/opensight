import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 56: hover feedback for the sign-in link
// buttons (.sign-in-links button — "Retry connection" and "Explore
// sample data" in SignIn.tsx, "Explore sample data" in
// SessionGate.tsx). Static audit follow-on to slice 55: sign-in.css
// gave both of its block buttons a hover step (.sign-in-primary and
// .sign-in-secondary) and, since slice 55, its text fields one too
// (.sign-in-field input), but the link row carried no :hover rule at
// all — the buttons rest transparent with color #126e76 and an
// underline, and hovering changed nothing, while every other control
// on the surface steps. The links now take #0e5960 on hover — the
// sign-in surface's own darker teal (the .sign-in-primary hover
// shade). Color only, so resting geometry is identical. Static (no
// animation), so no reduced-motion variant is needed. The disabled
// state (the links are disabled while the sign-in form is busy) is
// excluded and keeps its flat resting state.
const css = await readFile(new URL('../src/sign-in.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.sign-in-links button:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the sign-in link hover rule exists', () => {
  assert.ok(hoverRule, 'expected the sign-in link hover rule');
  assert.match(hoverRule[1], /color:\s*#0e5960/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the sign-in link hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|background|text-decoration/.test(hoverRule[1]), 'hover must change color only');
});

test('the resting link rule still reserves the geometry the hover keeps', () => {
  const rest = css.match(/\.sign-in-links button\s*\{([^}]*)\}/);
  assert.ok(rest, 'expected the sign-in link resting rule');
  assert.match(rest[1], /padding:\s*4px 0/);
  assert.match(rest[1], /background:\s*transparent/);
  assert.match(rest[1], /color:\s*#126e76/);
  assert.match(rest[1], /text-decoration:\s*underline/);
});

test('the hover step coexists with the other sign-in hover rules', () => {
  assert.ok(css.match(/\.sign-in-primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#0e5960/), 'the sign-in primary hover rule must still be present');
  assert.ok(css.match(/\.sign-in-secondary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf4f4/), 'the sign-in secondary hover rule must still be present');
  assert.ok(css.match(/\.sign-in-field input:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf4f4/), 'the slice-55 sign-in field hover rule must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="sign-in-page"><section class="sign-in-card">
      <nav class="sign-in-links" aria-label="Sign-in help"><button id="retry" type="button">Retry connection</button><button id="demo" type="button" disabled>Explore sample data</button></nav>
    </section></div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '').includes('.sign-in-links button:hover')) rules.push(rule);
        }
      }
      const measure = (id) => {
        const el = document.querySelector(id);
        const rest = { color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        const hover = rules[0];
        if (hover) { for (const prop of hover.style) el.style.setProperty(prop, hover.style.getPropertyValue(prop)); }
        const hovered = { color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      const demo = document.querySelector('#demo');
      return {
        ruleCount: rules.length,
        colorValue: rules.length ? rules[0].style.getPropertyValue('color') : null,
        retry: measure('#retry'),
        demoMatches: rules.length ? demo.matches(rules[0].selectorText.replace(':hover', '')) : null,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.colorValue, 'rgb(14, 89, 96)');
    assert.equal(actual.retry.rest.color, 'rgb(18, 110, 118)');
    assert.equal(actual.retry.hovered.color, 'rgb(14, 89, 96)');
    assert.notEqual(actual.retry.rest.color, actual.retry.hovered.color);
    assert.equal(actual.retry.rest.box, actual.retry.hovered.box);
    assert.equal(actual.demoMatches, false, 'disabled link buttons must be excluded from the hover rule');
  });
}
