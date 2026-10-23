import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 109: hover feedback for the author build
// panel's "Change visual type" label (label.change-type in
// Author.tsx — text + select inside .visual-config in the
// .build-panel Panel in .author-layout in .author-workspace).
// The .author-layout label rule lays it out as a column flex
// (text line, gap, field), so the label has real visible area,
// but it had zero hover feedback: every label :hover rule in the
// cascade is scoped elsewhere (author toggles, parameter/action
// editor checkbox and radio labels, the O-mode notice label,
// admin dialog labels, connector/sign-in/collection labels, and
// the data-prep label series), so the label rested transparent
// in both chrome modes and hovering its text or gap changed
// nothing, while only the select inside it tinted via the author
// select hover. This was the fresh zero-hover audit on a new
// surface left by slice 108. The label now takes #edf7f7 (light)
// / #334c62 (dark chrome), the author surface's established
// hover tints (the author select hover and the slice-97 toggle
// label hover), so no new colour is introduced. Background
// only, so resting geometry is identical and there is no
// animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.change-type:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.change-type:hover\s*\{([^}]*)\}/m);

test('the change-type label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .change-type :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint matches the author select and toggle-label hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
  assert.ok(styleCss.match(/^label\.toggle:hover\s*\{[^}]*background:\s*#edf7f7/m), 'the toggle label hover must remain #edf7f7');
});

test('the change-type label hover rules are paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(darkRule, 'expected the dark hover rule');
  for (const r of [rule, darkRule]) assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
});

test('the dark variant uses the author dark hover tint and the resting change-type and author label rules are preserved', () => {
  assert.ok(darkRule, 'expected the dark .change-type :hover rule');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark select hover must remain #334c62');
  assert.ok(styleCss.match(/^\.change-type\s*\{[^}]*max-width:\s*230px/m), 'the change-type resting rule must remain');
  assert.ok(styleCss.match(/\.author-layout label, \.analysis-title, \.rename-sheet label, \.calculation-dialog label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/), 'the author label resting rule must remain');
});

describe('Change-type label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the real ancestor context in both chrome modes, and other labels are out of scope', async () => {
    const panel = (id, wellId) => `<details class="builder-panel build-panel" open><div class="panel-content">`
      + `<div class="visual-config"><h3>Field wells</h3>`
      + `<label class="change-type" id="${id}">Change visual type<select><option>Bar</option></select></label>`
      + `<div class="field-wells"><fieldset><label class="well-picker" id="${wellId}"><span class="sr-only">Assign rows</span><select><option>Choose field…</option></select></label></fieldset></div>`
      + `</div></div></details>`;
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-layout">${panel('changeLight', 'wellLight')}</div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout">${panel('changeDark', 'wellDark')}</div></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const found = all.find(r => norm(r) === '.change-type:hover') ?? null;
      const foundDark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .change-type:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        found: !!found,
        foundDark: !!foundDark,
        props: found ? [...found.style] : [],
        darkProps: foundDark ? [...foundDark.style] : [],
        light: found ? measure(el('changeLight'), found) : null,
        dark: foundDark ? measure(el('changeDark'), foundDark) : null,
        wellLightMatches: found ? el('wellLight').matches('.change-type') : null,
        darkOnLightMatches: foundDark ? el('changeLight').matches(foundDark.selectorText.replaceAll(':hover', '')) : null,
        darkOnWellMatches: foundDark ? el('wellDark').matches(foundDark.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.foundDark, 'expected the dark hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.ok(actual.darkProps.length && actual.darkProps.every(p => p.startsWith('background')), 'dark hover rule must set background longhands only');
    assert.equal(actual.light.rest.background, 'rgba(0, 0, 0, 0)', 'light label rest (transparent)');
    assert.equal(actual.light.hovered.background, 'rgb(237, 247, 247)', 'light label hover');
    assert.notEqual(actual.light.rest.background, actual.light.hovered.background);
    assert.equal(actual.light.rest.color, actual.light.hovered.color, 'light label colour unchanged on hover');
    assert.equal(actual.light.rest.box, actual.light.hovered.box, 'light label geometry');
    assert.equal(actual.dark.rest.background, 'rgba(0, 0, 0, 0)', 'dark label rest (transparent)');
    assert.equal(actual.dark.hovered.background, 'rgb(51, 76, 98)', 'dark label hover');
    assert.notEqual(actual.dark.rest.background, actual.dark.hovered.background);
    assert.equal(actual.dark.rest.color, actual.dark.hovered.color, 'dark label colour unchanged on hover');
    assert.equal(actual.dark.rest.box, actual.dark.hovered.box, 'dark label geometry');
    assert.equal(actual.wellLightMatches, false, 'the well-picker label in the same panel must be out of scope');
    assert.equal(actual.darkOnLightMatches, false, 'the dark rule must not reach the light-chrome label');
    assert.equal(actual.darkOnWellMatches, false, 'the dark rule must not reach the well-picker label');
  });
});
