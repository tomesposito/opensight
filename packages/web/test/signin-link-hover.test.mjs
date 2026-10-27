import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

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
const css = styles['sign-in.css'];

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

defineHoverCases('signin-link hover', {
  html: `<div class="sign-in-page"><section class="sign-in-card">
      <nav class="sign-in-links" aria-label="Sign-in help"><button id="retry" type="button">Retry connection</button><button id="demo" type="button" disabled>Explore sample data</button></nav>
    </section></div>`,
  cases: [
    {
      target: '#retry',
      rule: '.sign-in-links button:hover:not(:disabled)',
      resting: { color: 'rgb(18, 110, 118)', backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { color: 'rgb(14, 89, 96)', backgroundColor: 'rgba(0, 0, 0, 0)' },
      paintOnly: true,
      excluded: ['#demo'],
    },
  ],
});
