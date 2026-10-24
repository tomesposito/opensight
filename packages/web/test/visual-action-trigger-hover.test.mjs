import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

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
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

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

describe('Visual-action trigger hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the dashboard trigger visual state with identical geometry, the author triggers keep their generic hovers, and a trigger outside the dashboard grid is out of scope', async () => {
    const menu = id => `<div class="visual-action-menu"><button type="button" id="${id}" aria-haspopup="menu" aria-expanded="false" aria-label="Run action">⋯</button><div role="menu"><button type="button" role="menuitem" id="${id}Item">Act</button></div></div>`;
    const card = id => `<section class="visual-card"><header class="card-heading"><div class="card-titles"><h3>T</h3></div>${menu(id)}</header></section>`;
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="app-shell"><main><div class="dashboard-grid">${card('dashTrigger')}</div></main></div>`
      + `<div class="author-workspace"><div class="author-center">${card('authorTrigger')}</div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-center">${card('darkTrigger')}</div></div>`
      + `<main>${card('outsideTrigger')}</main>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const find = sel => all.find(r => norm(r) === sel) ?? null;
      const triggerRuleFound = find('.dashboard-grid .visual-action-menu > button:hover:not(:disabled)');
      const itemRule = find('.visual-action-menu [role=menuitem]:hover:not(:disabled)');
      const authorRule = find('.author-workspace button:hover:not(:disabled), .author-layout button:hover:not(:disabled)');
      const darkRule = all.find(r => norm(r).includes('[data-chrome=dark] button:hover:not(:disabled)') && norm(r).startsWith('.author-workspace')) ?? null;
      const el = id => document.querySelector(`#${id}`);
      const measure = (target, found) => {
        const rest = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        if (found) { for (const prop of found.style) target.style.setProperty(prop, found.style.getPropertyValue(prop), found.style.getPropertyPriority(prop)); }
        const hovered = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        target.removeAttribute('style');
        return { rest, hovered };
      };
      return {
        found: !!triggerRuleFound,
        props: triggerRuleFound ? [...triggerRuleFound.style] : [],
        dash: triggerRuleFound ? measure(el('dashTrigger'), triggerRuleFound) : null,
        dashItem: itemRule ? measure(el('dashTriggerItem'), itemRule) : null,
        author: authorRule ? measure(el('authorTrigger'), authorRule) : null,
        dark: darkRule ? measure(el('darkTrigger'), darkRule) : null,
        outsideMatches: el('outsideTrigger').matches('.dashboard-grid .visual-action-menu > button'),
      };
    });
    assert.equal(actual.found, true, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.dash.rest.background, 'rgb(239, 239, 239)', 'dashboard trigger rest is the UA default');
    assert.equal(actual.dash.hovered.background, 'rgb(232, 241, 243)', 'dashboard trigger hover');
    assert.notEqual(actual.dash.rest.background, actual.dash.hovered.background);
    assert.equal(actual.dash.rest.color, actual.dash.hovered.color, 'dashboard trigger colour unchanged on hover');
    assert.equal(actual.dash.rest.box, actual.dash.hovered.box, 'dashboard trigger geometry');
    assert.equal(actual.dashItem.hovered.background, 'rgb(232, 241, 243)', 'the menuitem keeps its own hover tint');
    assert.equal(actual.author.hovered.background, 'rgb(237, 247, 247)', 'the author light trigger keeps the generic author hover');
    assert.equal(actual.dark.hovered.background, 'rgb(51, 76, 98)', 'the author dark trigger keeps the generic dark author hover');
    assert.equal(actual.outsideMatches, false, 'a visual-action trigger outside .dashboard-grid must be out of scope');
  });
});
