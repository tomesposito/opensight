import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 98: hover feedback for the O-mode notice's
// "Generative mode" label (.o-mode-notice label in OModeNotice.tsx,
// wrapping its role=switch checkbox). It renders in the standalone O
// entry (.o-entry), the author toolbar form (.o-entry-toolbar in
// light and dark chrome), the Ask O side panel, and BuildForMe inside
// the calculation dialog — and had zero hover feedback in all of
// them. Every :hover rule is scoped elsewhere or excludes it: the
// author and dialog field hovers reach inputs, not labels, and
// checkbox/switch inputs are deliberately excluded from the field
// hovers so native controls keep their OS rendering. A CSSOM probe
// with all five real stylesheets (1,352 rules) in the real ancestor
// contexts confirmed zero matching :hover rules for the label and a
// transparent rest in all of them (the switch itself steps only
// inside the calculation dialog, via that dialog's generic input
// hover, slice 46). The label now takes #edf7f7, the author surface's
// established hover tint (the author button and field hovers, the
// calculation-dialog hovers, and the Ask O panel's fallback hover
// tint), so no new colour is introduced. The rule is on the label,
// not the switch: the switch keeps its native rendering, following
// the slice-94 connector-toggle, slice-95 sign-in-check, slice-96
// favorites-filter and slice-97 toggle-label precedents where the
// label surface hovers and its inner input does not. The dark-chrome
// variant takes the author dark hover tint (#334c62, the dark button
// and field hovers); the calculation dialog renders outside
// .author-workspace (slice 46) and is a fixed-light surface, so the
// BuildForMe rendering keeps the light tint. Background only, so
// resting geometry is identical and there is no animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.o-mode-notice label:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.o-mode-notice label:hover\s*\{([^}]*)\}/m);

test('the O-mode label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .o-mode-notice label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint matches the author button and calculation-dialog input hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author button hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.calculation-dialog input:hover:not\(:disabled\), \.calculation-dialog select:hover:not\(:disabled\), \.calculation-dialog textarea:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the calculation-dialog input hover must remain #edf7f7');
});

test('the O-mode label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting O-mode rules are preserved, the switch has no hover rule of its own, and the dark variant uses the author dark hover tint', () => {
  assert.ok(styleCss.match(/\.o-mode-notice label\s*\{[^}]*flex-direction:\s*row[^}]*white-space:\s*nowrap/), 'the O-mode label resting rule must remain');
  assert.ok(styleCss.match(/\.o-mode-notice input\[type=checkbox\]\s*\{[^}]*width:\s*auto/), 'the O-mode switch resting rule must remain');
  assert.ok(!/\.o-mode-notice input:hover/.test(styleCss), 'the switch must keep its native rendering with no hover rule of its own');
  assert.ok(!/\.o-mode-notice label:hover[^{]*\{[^}]*input/.test(styleCss), 'the label hover rule must not target the switch');
  assert.ok(darkRule, 'expected the author dark-chrome O-mode label hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark button hover must remain #334c62');
});

const notice = id => `<div class="o-mode-notice"><label id="${id}"><input type="checkbox" role="switch">Generative mode</label><small>Needs hosted API</small></div>`;

defineHoverCases('o-mode-label hover', {
  html: `<section class="o-entry">${notice('lblStandalone')}</section>`
      + `<div class="author-workspace" data-chrome="light"><section class="o-entry o-entry-toolbar">${notice('lblLight')}</section></div>`
      + `<div class="author-workspace" data-chrome="dark"><section class="o-entry o-entry-toolbar">${notice('lblDark')}</section></div>`
      + `<dialog class="calculation-dialog" open><details class="o-build-for-me" open>${notice('lblDialog')}</details></dialog>`
      + `<aside class="q-side-panel"><div class="q-panel-content"><section class="o-entry">${notice('lblPanel')}</section></div></aside>`
      + `<label id="outsideLabel"><input type="checkbox">Other label</label>`,
  cases: [
    {
      target: '#lblStandalone',
      rule: '.o-mode-notice label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#lblStandalone > input:nth-child(1)', '#outsideLabel'],
    },
    {
      target: '#lblLight',
      rule: '.o-mode-notice label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lblDark',
      rule: '.author-workspace[data-chrome="dark"] .o-mode-notice label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lblDialog',
      rule: '.o-mode-notice label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lblPanel',
      rule: '.o-mode-notice label:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
