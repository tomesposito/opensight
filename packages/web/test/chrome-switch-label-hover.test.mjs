import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 133: hover feedback for the NEW LOOK switch's
// label (.author-workspace[data-chrome] label.chrome-switch — "NEW LOOK"
// text plus its theme select in AuthorToolbar.tsx's nav.author-menu, at
// the right end of the author menu bar). The resting rule
// (.author-workspace[data-chrome] label.chrome-switch { display: flex;
// gap: 8px; align-items: center; border-left: 1px solid
// var(--header-border); ... }) makes the label a visible surface, but
// the label had zero hover feedback: its select hovers (the
// chrome-switch select hover plus the generic author select hover), the
// neighbouring menu summaries and the analysis-search button hover, and
// the fixture-picker label in the product header hovers as a whole —
// but every label :hover rule in the cascade is scoped elsewhere, so
// the label rested transparent and hovering its text or gap changed
// nothing, while only the field inside it tinted. A CSSOM probe with
// all five real stylesheets (1,407 rules) in the real ancestor context
// (.author-workspace[data-chrome] > nav.author-menu) confirmed zero
// matching :hover rules for the label and a transparent rest, while the
// inner select matched both of its hover rules. The label now takes
// var(--header-pressed), the select's own hover expression (the
// fixture-picker precedent: the label takes its field's hover tint), so
// no new colour is introduced and label and field read as one surface.
// The header vars are defined on .author-workspace and shared by both
// chromes, so the one rule covers light and dark chrome alike.
// Background only, so resting geometry is identical and there is no
// animation.
const styleCss = styles['style.css'];

const labelRule = styleCss.match(/^\.author-workspace\[data-chrome\] label\.chrome-switch:hover\s*\{([^}]*)\}/m);

test('the chrome-switch label hover rule exists and uses the header-pressed expression', () => {
  assert.ok(labelRule, 'expected the .author-workspace[data-chrome] label.chrome-switch:hover rule');
  assert.match(labelRule[1], /background:\s*var\(--header-pressed\)/);
});

test('the hover tint matches the chrome-switch select hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome\] \.chrome-switch select:hover\s*\{[^}]*background:\s*var\(--header-pressed\)/), 'the chrome-switch select hover must remain var(--header-pressed)');
  assert.ok(styleCss.match(/\.author-workspace\s*\{[^}]*--header-pressed:\s*#0b435f/), '--header-pressed must remain #0b435f on .author-workspace');
});

test('the label hover rule is paint-only: resting geometry and text colour cannot shift', () => {
  assert.ok(labelRule, 'expected the chrome-switch label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting chrome-switch rules are preserved', () => {
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome\] label\.chrome-switch\s*\{[^}]*display:\s*flex[^}]*border-left:\s*1px solid var\(--header-border\)/), 'the resting chrome-switch label rule must remain');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome\] \.chrome-switch select\s*\{[^}]*background:\s*var\(--header-bg\)/), 'the resting chrome-switch select rule must remain');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome\] \.chrome-switch select:focus-visible\s*\{[^}]*outline-color:\s*var\(--header-focus\)/), 'the chrome-switch select focus rule must remain');
});

defineHoverCases('chrome-switch-label hover', {
  html: `<div class="author-workspace" data-chrome="light"><nav class="author-menu"><label class="chrome-switch" id="lightLabel">NEW LOOK<select id="lightSelect" aria-label="NEW LOOK"><option>Light</option><option>Dark</option></select></label><label id="plainLabel">Plain</label></nav></div>`
      + `<div class="author-workspace" data-chrome="dark"><nav class="author-menu"><label class="chrome-switch" id="darkLabel">NEW LOOK<select aria-label="NEW LOOK"><option>Light</option><option>Dark</option></select></label></nav></div>`
      + `<label class="chrome-switch" id="outsideLabel">NEW LOOK<select aria-label="NEW LOOK"><option>Light</option></select></label>`,
  cases: [
    {
      target: '#lightLabel',
      rule: '.author-workspace[data-chrome] label.chrome-switch:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(11, 67, 95)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#plainLabel', '#outsideLabel'],
    },
    {
      target: '#darkLabel',
      rule: '.author-workspace[data-chrome] label.chrome-switch:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(11, 67, 95)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lightSelect',
      rule: '.author-workspace[data-chrome] .chrome-switch select:hover',
      resting: { backgroundColor: 'rgb(14, 26, 51)' },
      hovered: { backgroundColor: 'rgb(11, 67, 95)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
