import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 55: hover feedback for the sign-in form
// fields (.sign-in-field input — Email address, Password,
// and the Authenticator code input). Static audit: sign-in.css
// gave both of its buttons a hover step (.sign-in-primary and
// .sign-in-secondary) but carried no field :hover rule at all — the
// text inputs rest at #fff, but hovering changed nothing, while
// fields on every other surface tint (data slices 16/21/27/48, embed
// slice 54). The fields now take #eef3fd on hover — the sign-in
// surface's own tint (the .sign-in-secondary hover step and the info
// alert background). Background only, so resting geometry is
// identical. Static (no animation), so no reduced-motion variant is
// needed. The disabled state (the code input while busy) is excluded
// and keeps its flat resting state; the native checkboxes
// (.sign-in-check) keep OS rendering by design and are not matched —
// the rule is scoped to .sign-in-field, which wraps text inputs only.
const css = styles['sign-in.css'];

const hoverRule = css.match(/\.sign-in-field input:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the sign-in field hover rule exists', () => {
  assert.ok(hoverRule, 'expected the sign-in field hover rule');
  assert.match(hoverRule[1], /background:\s*#eef3fd/);
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
  assert.match(rest[1], /border:\s*1px solid #c3cfe0/);
  assert.match(rest[1], /background:\s*#fff/);
});

test('the hover step coexists with the sign-in button hover rules', () => {
  assert.ok(css.match(/\.sign-in-primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#2f66d8/), 'the sign-in primary hover rule must still be present');
  assert.ok(css.match(/\.sign-in-secondary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the sign-in secondary hover rule must still be present');
});

defineHoverCases('signin-field hover', {
  html: `<div class="sign-in-page"><main class="sign-in-main"><section class="sign-in-card"><form>
      <label class="sign-in-field" for="email">Email address<input id="email" type="email" value="a@example.com"></label>
      <label class="sign-in-field" for="code">Authenticator code<input id="code" class="sign-in-code" type="text" value="123456" disabled></label>
    </form></section></main></div>`,
  cases: [
    {
      target: '#email',
      rule: '.sign-in-field input:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      excluded: ['#code'],
    },
  ],
});
