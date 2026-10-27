import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 132: hover feedback for the Ask O panel's
// question label (.q-side-panel .o-bar label — "Ask a question" in
// OEntry.tsx's form.o-bar, rendered inside .q-panel-content of
// QSidePanel.tsx). The resting rules (.o-bar { display: flex;
// flex-wrap: wrap; gap: 8px; }, .o-bar label { font-weight: 650; } and
// .q-side-panel .o-bar label { flex-basis: 100%; }) make the label a
// full-width row of the panel's question bar, directly above the search
// input. Every label :hover rule in the cascade is scoped elsewhere —
// the panel's own input (slice 58) and buttons hover via
// var(--chrome-menu-hover, #edf7f7), and the mode-notice label inside
// the same panel hovers — so the label rested transparent and hovering
// its row changed nothing, while the field below it tinted. A CSSOM
// probe with all five real stylesheets (1,406 rules) in the real
// ancestor context (.q-side-panel > .q-panel-content > section.o-entry
// > form.o-bar) confirmed zero matching :hover rules for the label and
// a transparent rest. The label now takes the panel's own hover
// expression, var(--chrome-menu-hover, #edf7f7) — the exact background
// of the panel button hover and the slice-58 input hover — so no new
// colour is introduced, label and field read as one surface, and dark
// chrome resolves the var to #293f55 exactly like the panel buttons.
// Background only, so resting geometry is identical and there is no
// animation. Scoped to .q-side-panel: in the author-menu variant the
// same label is visually hidden (clipped), and the embed context is
// already covered by embed.css, so both stay unchanged.
const styleCss = styles['style.css'];

const labelRule = styleCss.match(/^\.q-side-panel \.o-bar label:hover\s*\{([^}]*)\}/m);

test('the Ask O panel question label hover rule exists and uses the panel hover expression', () => {
  assert.ok(labelRule, 'expected the .q-side-panel .o-bar label:hover rule');
  assert.match(labelRule[1], /background:\s*var\(--chrome-menu-hover, #edf7f7\)/);
});

test('the hover tint matches the panel button and slice-58 input hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.q-side-panel button:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--chrome-menu-hover, #edf7f7\)/), 'the panel button hover must remain var(--chrome-menu-hover, #edf7f7)');
  assert.ok(styleCss.match(/\.q-side-panel \.o-bar input:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--chrome-menu-hover, #edf7f7\)/), 'the slice-58 panel input hover must remain var(--chrome-menu-hover, #edf7f7)');
});

test('the label hover rule is paint-only: resting geometry and text colour cannot shift', () => {
  assert.ok(labelRule, 'expected the panel label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting o-bar rules are preserved', () => {
  assert.ok(styleCss.match(/\.o-bar\s*\{[^}]*display:\s*flex[^}]*gap:\s*8px/), 'the resting o-bar flex rule must remain');
  assert.ok(styleCss.match(/\.o-bar label\s*\{[^}]*font-weight:\s*650/), 'the resting o-bar label rule must remain');
  assert.ok(styleCss.match(/\.q-side-panel \.o-bar label\s*\{[^}]*flex-basis:\s*100%/), 'the resting panel o-bar label rule must remain');
  assert.ok(styleCss.match(/\.author-menu \.o-bar label\s*\{[^}]*clip:\s*rect\(0, 0, 0, 0\)/), 'the visually hidden author-menu label rule must remain');
});

defineHoverCases('o-bar-label hover', {
  html: `<div class="q-side-panel"><header class="q-panel-heading"><h2>ASK O</h2></header><div class="q-panel-content"><section class="o-entry"><form class="o-bar"><label id="panelLabel" for="o-question">Ask a question</label><input id="o-question" type="search"/><button type="submit">Ask</button></form><label id="plainPanelLabel">Plain</label></section></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="q-side-panel"><div class="q-panel-content"><section class="o-entry"><form class="o-bar"><label id="darkLabel" for="o-question-dark">Ask a question</label><input id="o-question-dark" type="search"/></form></section></div></div></div>`
      + `<div class="author-workspace"><div class="author-menu"><form class="o-bar"><label id="menuLabel" for="o-question-menu">Ask a question</label><input id="o-question-menu" type="search"/></form></div></div>`,
  cases: [
    {
      target: '#panelLabel',
      rule: '.q-side-panel .o-bar label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#menuLabel', '#plainPanelLabel'],
    },
    {
      target: '#darkLabel',
      rule: '.q-side-panel .o-bar label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(41, 63, 85)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#o-question',
      rule: '.q-side-panel .o-bar input:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
