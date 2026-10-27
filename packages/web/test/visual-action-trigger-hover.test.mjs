import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 130: hover feedback for the visual action
// menu's trigger button (.visual-action-menu > button — the "⋯" button
// with aria-label "Run action" in VisualActionMenu.tsx, rendered inside
// header.card-heading of VisualCard). The menu is passed as actionMenu
// only from Dashboard.tsx (VisualCard inside .dashboard-grid) and
// Author.tsx (AuthorCard inside .author-workspace); the embed surfaces
// render VisualCard without an actionMenu, so no trigger exists there.
// In the author contexts the trigger already hovers via the generic
// author button hovers (light #edf7f7, dark #334c62), but on the
// dashboard it matched no :hover rule at all: every button :hover rule
// in the cascade is scoped elsewhere (author, data-page, data-dialog,
// embed, sign-in, Ask O panel scopes), so it rested at the UA default
// rgb(239,239,239) and hovering changed nothing, while the menuitems
// inside its own menu tint via their hover rule. A CSSOM probe with
// all five real stylesheets (1,404 rules) in the real ancestor
// contexts confirmed zero matching :hover rules and the UA-default
// rest for the dashboard trigger, the generic author hovers in the
// author contexts, and the menuitem rule alone for the menuitems.
// The trigger now takes #e8f1f3 on the dashboard — the hover tint of
// its own menu's menuitems, so no new colour is introduced and the
// trigger and its menu read as one surface. The rule is scoped to
// .dashboard-grid so the author contexts keep their existing generic
// hovers exactly. Background only, so resting geometry is identical
// and there is no animation.
const styleCss = styles['style.css'];

const triggerRule = styleCss.match(/^\.dashboard-grid \.visual-action-menu > button:hover:not\(:disabled\)\s*\{([^}]*)\}/m);

test('the dashboard visual-action trigger hover rule exists and uses the menu hover tint', () => {
  assert.ok(triggerRule, 'expected the .dashboard-grid .visual-action-menu > button:hover rule');
  assert.match(triggerRule[1], /background:\s*#e8f1f3/);
});

test('the hover tint matches the menuitems in the same menu, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.visual-action-menu \[role=menuitem\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8f1f3/), 'the menuitem hover must remain #e8f1f3');
});

test('the trigger hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(triggerRule, 'expected the trigger :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(triggerRule[1]), 'hover must change background only');
});

test('the resting visual-action-menu rules are preserved and the author generic hovers are untouched', () => {
  assert.ok(styleCss.match(/\.visual-action-menu\s*\{[^}]*position:\s*relative/), 'the resting menu rule must remain');
  assert.ok(styleCss.match(/\.visual-action-menu \[role=menuitem\]\s*\{[^}]*background:\s*transparent/), 'the resting menuitem rule must remain');
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author light generic button hover must remain');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark generic button hover must remain');
});

const menu = id => `<div class="visual-action-menu"><button type="button" id="${id}" aria-haspopup="menu" aria-expanded="false" aria-label="Run action">⋯</button><div role="menu"><button type="button" role="menuitem" id="${id}Item">Act</button></div></div>`;
    const card = id => `<section class="visual-card"><header class="card-heading"><div class="card-titles"><h3>T</h3></div>${menu(id)}</header></section>`;

defineHoverCases('visual-action-trigger hover', {
  html: `<div class="app-shell"><main><div class="dashboard-grid">${card('dashTrigger')}</div></main></div>`
      + `<div class="author-workspace"><div class="author-center">${card('authorTrigger')}</div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-center">${card('darkTrigger')}</div></div>`
      + `<main>${card('outsideTrigger')}</main>`,
  cases: [
    {
      target: '#dashTrigger',
      rule: '.dashboard-grid .visual-action-menu > button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(239, 239, 239)' },
      hovered: { backgroundColor: 'rgb(232, 241, 243)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideTrigger'],
    },
    {
      target: '#dashTriggerItem',
      rule: '.visual-action-menu [role="menuitem"]:hover:not(:disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 241, 243)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#authorTrigger',
      rule: '.author-workspace button:hover:not(:disabled), .author-layout button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#darkTrigger',
      rule: '.author-workspace[data-chrome="dark"] button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(32, 46, 64)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
