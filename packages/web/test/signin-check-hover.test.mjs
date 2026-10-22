import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 95: hover feedback for the sign-in form's
// checkbox labels (label.sign-in-check in SignIn.tsx — "Show password"
// and "Remember me for this session", each wrapping its checkbox in
// the credentials form inside section.sign-in-card). They had zero
// hover feedback. Every :hover rule on the sign-in surface is scoped
// elsewhere — the field inputs (.sign-in-field input, slice 55), the
// primary/secondary buttons and the help-link buttons — and checkbox
// inputs are deliberately excluded from the field-hover rule so
// native controls keep their OS rendering, so neither the labels nor
// their checkboxes matched any :hover rule, while the fields they sit
// between (slices 55) and both buttons do step. A CSSOM probe with
// all five real stylesheets (1,347 rules) in the real ancestor
// context (div.sign-in-page > main.sign-in-main >
// section.sign-in-card > form > label.sign-in-check) confirmed zero
// matching :hover rules and a transparent rest for both the label and
// the checkbox. The label now takes the sign-in surface's established
// hover tint (#eaf4f4 — its own field hover, slice 55, and the
// secondary button hover, and the info alert background), so no new
// colour is introduced. The rule is on the label, not the checkbox:
// the checkbox keeps its native rendering, following the slice-94
// connector-toggle precedent where the label surface hovers and its
// inner input does not. Background only, so resting geometry is
// identical and there is no animation. The sign-in page is a
// fixed-light surface, so no dark variant is added.
const css = await readFile(new URL('../src/sign-in.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = css.match(/^\.sign-in-check:hover\s*\{([^}]*)\}/m);

test('the sign-in-check hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .sign-in-check :hover rule');
  assert.match(rule[1], /background:\s*#eaf4f4/);
});

test('the hover tint matches the sign-in field and secondary hovers, so no new colour is introduced', () => {
  assert.ok(css.match(/\.sign-in-field input:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf4f4/), 'the sign-in field hover must remain #eaf4f4');
  assert.ok(css.match(/\.sign-in-secondary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf4f4/), 'the sign-in secondary hover must remain #eaf4f4');
});

test('the check hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting check rules are preserved and the checkbox has no hover rule of its own', () => {
  assert.ok(css.match(/\.sign-in-check\s*\{[^}]*display:\s*flex[^}]*cursor:\s*pointer/), 'the sign-in-check resting rule must remain');
  assert.ok(css.match(/\.sign-in-check input\s*\{[^}]*accent-color:\s*#157f88/), 'the sign-in-check input resting rule must remain');
  assert.ok(!/\.sign-in-check input:hover/.test(css), 'the checkbox must keep its native rendering with no hover rule of its own');
  assert.ok(!/\.sign-in-check:hover[^{]*\{[^}]*input/.test(css), 'the check hover rule must not target the checkbox');
});

describe('Sign-in-check hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry, and the checkbox and outside labels are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="sign-in-page"><main class="sign-in-main"><section class="sign-in-card"><form>`
      + `<label class="sign-in-check" id="checkLabel"><input id="checkBox" type="checkbox">Show password</label>`
      + `</form></section></main></div>`
      + `<label id="outsideLabel"><input type="checkbox">Other check</label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.sign-in-check:hover') ?? null;
      const label = document.querySelector('#checkLabel');
      const box = document.querySelector('#checkBox');
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const bare = found ? found.selectorText.replaceAll(':hover', '') : '';
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        label: found ? measure(label, found) : null,
        boxMatches: found ? box.matches(bare) : null,
        outsideMatches: found ? document.querySelector('#outsideLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.label.rest.background, 'rgba(0, 0, 0, 0)', 'sign-in-check label rest (transparent)');
    assert.equal(actual.label.hovered.background, 'rgb(234, 244, 244)', 'sign-in-check label hover');
    assert.notEqual(actual.label.rest.background, actual.label.hovered.background);
    assert.equal(actual.label.rest.color, actual.label.hovered.color, 'sign-in-check label colour unchanged on hover');
    assert.equal(actual.label.rest.box, actual.label.hovered.box, 'sign-in-check label geometry');
    assert.equal(actual.boxMatches, false, 'the checkbox inside .sign-in-check must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a label outside .sign-in-check must be out of scope');
  });
});
