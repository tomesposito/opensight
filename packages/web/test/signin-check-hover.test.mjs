import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

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
// hover tint (#eef3fd — its own field hover, slice 55, and the
// secondary button hover, and the info alert background), so no new
// colour is introduced. The rule is on the label, not the checkbox:
// the checkbox keeps its native rendering, following the slice-94
// connector-toggle precedent where the label surface hovers and its
// inner input does not. Background only, so resting geometry is
// identical and there is no animation. The sign-in page is a
// fixed-light surface, so no dark variant is added.
const css = styles['sign-in.css'];

const rule = css.match(/^\.sign-in-check:hover\s*\{([^}]*)\}/m);

test('the sign-in-check hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .sign-in-check :hover rule');
  assert.match(rule[1], /background:\s*#eef3fd/);
});

test('the hover tint matches the sign-in field and secondary hovers, so no new colour is introduced', () => {
  assert.ok(css.match(/\.sign-in-field input:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the sign-in field hover must remain #eef3fd');
  assert.ok(css.match(/\.sign-in-secondary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the sign-in secondary hover must remain #eef3fd');
});

test('the check hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting check rules are preserved and the checkbox has no hover rule of its own', () => {
  assert.ok(css.match(/\.sign-in-check\s*\{[^}]*display:\s*flex[^}]*cursor:\s*pointer/), 'the sign-in-check resting rule must remain');
  assert.ok(css.match(/\.sign-in-check input\s*\{[^}]*accent-color:\s*#3b82f6/), 'the sign-in-check input resting rule must remain');
  assert.ok(!/\.sign-in-check input:hover/.test(css), 'the checkbox must keep its native rendering with no hover rule of its own');
  assert.ok(!/\.sign-in-check:hover[^{]*\{[^}]*input/.test(css), 'the check hover rule must not target the checkbox');
});

defineHoverCases('signin-check hover', {
  html: `<div class="sign-in-page"><main class="sign-in-main"><section class="sign-in-card"><form>`
      + `<label class="sign-in-check" id="checkLabel"><input id="checkBox" type="checkbox">Show password</label>`
      + `</form></section></main></div>`
      + `<label id="outsideLabel"><input type="checkbox">Other check</label>`,
  cases: [
    {
      target: '#checkLabel',
      rule: '.sign-in-check:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#checkBox', '#outsideLabel'],
    },
  ],
});
