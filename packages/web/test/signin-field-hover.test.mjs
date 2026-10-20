import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 55: hover feedback for the sign-in form
// fields (.sign-in-field input — Email address, Password, Workspace
// ID, and the Authenticator code input). Static audit: sign-in.css
// gave both of its buttons a hover step (.sign-in-primary and
// .sign-in-secondary) but carried no field :hover rule at all — the
// four text inputs rest at #fff, but hovering changed nothing, while
// fields on every other surface tint (data slices 16/21/27/48, embed
// slice 54). The fields now take #eaf4f4 on hover — the sign-in
// surface's own tint (the .sign-in-secondary hover step and the info
// alert background). Background only, so resting geometry is
// identical. Static (no animation), so no reduced-motion variant is
// needed. The disabled state (the code input while busy) is excluded
// and keeps its flat resting state; the native checkboxes
// (.sign-in-check) keep OS rendering by design and are not matched —
// the rule is scoped to .sign-in-field, which wraps text inputs only.
const css = await readFile(new URL('../src/sign-in.css', import.meta.url), 'utf8');

const hoverRule = css.match(/\.sign-in-field input:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the sign-in field hover rule exists', () => {
  assert.ok(hoverRule, 'expected the sign-in field hover rule');
  assert.match(hoverRule[1], /background:\s*#eaf4f4/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the sign-in field hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting field rule still reserves the geometry the hover keeps', () => {
  const rest = css.match(/\.sign-in-field input\s*\{([^}]*)\}/);
  assert.ok(rest, 'expected the sign-in field resting rule');
  assert.match(rest[1], /height:\s*36px/);
  assert.match(rest[1], /padding:\s*6px 8px/);
  assert.match(rest[1], /border:\s*1px solid #91a5af/);
  assert.match(rest[1], /background:\s*#fff/);
});

test('the hover step coexists with the sign-in button hover rules', () => {
  assert.ok(css.match(/\.sign-in-primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#0e5960/), 'the sign-in primary hover rule must still be present');
  assert.ok(css.match(/\.sign-in-secondary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf4f4/), 'the sign-in secondary hover rule must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="sign-in-page"><main class="sign-in-main"><section class="sign-in-card"><form>
      <label class="sign-in-field" for="email">Email address<input id="email" type="email" value="a@example.com"></label>
      <label class="sign-in-field" for="code">Authenticator code<input id="code" class="sign-in-code" type="text" value="123456" disabled></label>
    </form></section></main></div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '').includes('.sign-in-field input:hover')) rules.push(rule);
        }
      }
      const measure = (id) => {
        const el = document.querySelector(id);
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        const hover = rules[0];
        if (hover) { for (const prop of hover.style) el.style.setProperty(prop, hover.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      const code = document.querySelector('#code');
      return {
        ruleCount: rules.length,
        backgroundValue: rules.length ? rules[0].style.getPropertyValue('background') : null,
        email: measure('#email'),
        codeMatches: rules.length ? code.matches(rules[0].selectorText.replace(':hover', '')) : null,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.equal(actual.backgroundValue, 'rgb(234, 244, 244)');
    assert.equal(actual.email.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.email.hovered.background, 'rgb(234, 244, 244)');
    assert.notEqual(actual.email.rest.background, actual.email.hovered.background);
    assert.equal(actual.email.rest.box, actual.email.hovered.box);
    assert.equal(actual.codeMatches, false, 'disabled inputs must be excluded from the field hover rule');
  });
}
