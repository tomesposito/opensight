import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 79: hover feedback for the author menu's
// OPEN summary (.author-menu details[open] > summary in
// AuthorMenuItem.tsx — File / Edit / Data / Insert / Sheets /
// Objects). The resting rule groups details[open] with :active at
// var(--header-pressed) (#0b435f, specificity (0,2,2) for the open
// variant), which beats the only hover rule (.author-menu
// summary:hover, var(--header-hover), (0,2,1)), so hovering an open
// menu's summary changed nothing, while every closed summary steps
// transparent -> var(--header-hover). Every menu renders closed by
// default (the exclusive name="analysis-menu" disclosure group), so
// route audits only ever hover the closed state — the slices
// 50/62/64/67/68 blind spot; slice 42 waved this control off as
// having "its own header hover", true only when closed. The open
// summary now takes var(--header-hover) (#126080) on hover: the
// closed summary's own hover colour and the in-bar precedent for a
// control resting at var(--header-pressed) (the Ask O bar button
// rests var(--header-pressed) -> hovers var(--header-hover)), so no
// new colour is introduced. Background only, so the open rule's
// inset focus shadow is kept and resting geometry is identical;
// static (no animation), so no reduced-motion variant.
const css = styles['style.css'];

const rule = css.match(/\.author-menu details\[open\] > summary:hover\s*\{([^}]*)\}/);

test('the open author-menu summary hover rule exists and uses the header hover colour', () => {
  assert.ok(rule, 'expected the .author-menu details[open] > summary:hover rule');
  assert.match(rule[1], /background:\s*var\(--header-hover\)/);
});

test('the hover colour is the existing --header-hover var, distinct from the --header-pressed rest', () => {
  assert.ok(css.match(/--header-hover:\s*#126080/), 'the --header-hover var must remain #126080');
  assert.ok(css.match(/--header-pressed:\s*#0b435f/), 'the --header-pressed var must remain #0b435f');
  assert.notEqual('#126080', '#0b435f', 'the hover colour must differ from the resting colour');
  assert.ok(css.match(/\.author-workspace \.author-menu \.o-bar button\s*\{[^}]*background:\s*var\(--header-pressed\)/), 'the Ask O bar button must still rest at var(--header-pressed)');
  assert.ok(css.match(/\.author-workspace \.author-menu \.o-bar button:hover:not\(:disabled\)\s*\{\s*background:\s*var\(--header-hover\)/), 'the Ask O bar button precedent hover must remain var(--header-hover)');
});

test('the open-summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting author-menu summary rules are preserved', () => {
  const open = css.match(/\.author-menu summary:active, \.author-menu details\[open\] > summary\s*\{([^}]*)\}/);
  assert.ok(open, 'expected the paired :active / details[open] resting rule');
  assert.match(open[1], /background:\s*var\(--header-pressed\)/);
  assert.match(open[1], /box-shadow:\s*inset 0 -3px var\(--header-focus\)/);
  assert.ok(css.match(/\.author-menu summary:hover, \.author-menu summary:focus-visible\s*\{\s*background:\s*var\(--header-hover\)/), 'the closed summary hover rule must remain');
  assert.ok(css.match(/\.author-menu summary\s*\{\s*padding:\s*8px/), 'the summary layout rule must remain');
});

test('the neighbouring author-menu hover rules are untouched', () => {
  assert.ok(css.match(/\.author-workspace\[data-chrome\] \.author-menu > button:hover:not\(:disabled\)\s*\{\s*background:\s*var\(--header-hover\)/), 'the menu-bar button hover must remain var(--header-hover)');
  assert.ok(css.match(/\.author-workspace\[data-chrome\] \.author-menu > button\[aria-pressed=true\]:hover:not\(:disabled\)\s*\{\s*background:\s*var\(--header-selected-hover\)/), 'the pressed menu-bar button hover must remain var(--header-selected-hover)');
});

defineHoverCases('author-menu-open-summary hover', {
  html: `<div class="author-workspace">
      <nav class="author-menu" aria-label="Analysis menu">
        <details name="analysis-menu" open><summary id="open">File</summary><div class="menu-popover"></div></details>
        <details name="analysis-menu"><summary id="closed">Edit</summary><div class="menu-popover"></div></details>
      </nav>
    </div>
    <details open><summary id="outside">Outside</summary></details>`,
  cases: [
    {
      target: '#open',
      rule: '.author-menu details[open] > summary:hover',
      resting: { backgroundColor: 'rgb(11, 67, 95)' },
      hovered: { backgroundColor: 'rgb(18, 96, 128)' },
      paintOnly: true,
      unchanged: ['boxShadow'],
      excluded: [{ target: '#closed', resting: { backgroundColor: 'rgba(0, 0, 0, 0)' } }, '#outside'],
    },
  ],
});
