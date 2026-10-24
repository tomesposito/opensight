import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

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
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

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

describe('chrome-switch label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry in both chromes, and labels outside the switch are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="author-workspace" data-chrome="light"><nav class="author-menu"><label class="chrome-switch" id="lightLabel">NEW LOOK<select id="lightSelect" aria-label="NEW LOOK"><option>Light</option><option>Dark</option></select></label><label id="plainLabel">Plain</label></nav></div>`
      + `<div class="author-workspace" data-chrome="dark"><nav class="author-menu"><label class="chrome-switch" id="darkLabel">NEW LOOK<select aria-label="NEW LOOK"><option>Light</option><option>Dark</option></select></label></nav></div>`
      + `<label class="chrome-switch" id="outsideLabel">NEW LOOK<select aria-label="NEW LOOK"><option>Light</option></select></label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const rule = all.find(r => norm(r) === '.author-workspace[data-chrome] label.chrome-switch:hover') ?? null;
      const selectRule = all.find(r => norm(r) === '.author-workspace[data-chrome] .chrome-switch select:hover') ?? null;
      const el = id => document.querySelector(`#${id}`);
      const measure = (target, found) => {
        const rest = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        if (found) target.style.cssText = found.style.cssText;
        const hovered = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        target.removeAttribute('style');
        return { rest, hovered };
      };
      return {
        found: !!rule,
        props: rule ? [...rule.style] : [],
        light: rule ? measure(el('lightLabel'), rule) : null,
        dark: rule ? measure(el('darkLabel'), rule) : null,
        select: selectRule ? measure(el('lightSelect'), selectRule) : null,
        plainMatches: el('plainLabel').matches('.author-workspace[data-chrome] label.chrome-switch'),
        outsideMatches: el('outsideLabel').matches('.author-workspace[data-chrome] label.chrome-switch'),
      };
    });
    assert.equal(actual.found, true, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.light.rest.background, 'rgba(0, 0, 0, 0)', 'light label rest');
    assert.equal(actual.light.hovered.background, 'rgb(11, 67, 95)', 'light label hover (var(--header-pressed) = #0b435f)');
    assert.notEqual(actual.light.rest.background, actual.light.hovered.background);
    assert.equal(actual.light.rest.color, actual.light.hovered.color, 'light label colour unchanged on hover');
    assert.equal(actual.light.rest.box, actual.light.hovered.box, 'light label geometry');
    assert.equal(actual.dark.rest.background, 'rgba(0, 0, 0, 0)', 'dark label rest');
    assert.equal(actual.dark.hovered.background, 'rgb(11, 67, 95)', 'dark label hover (header vars shared by both chromes)');
    assert.equal(actual.dark.rest.box, actual.dark.hovered.box, 'dark label geometry');
    assert.equal(actual.select.hovered.background, 'rgb(11, 67, 95)', 'the select hover takes the same tint, so label and field read as one surface');
    assert.equal(actual.plainMatches, false, 'a plain author-menu label must not match the switch selector');
    assert.equal(actual.outsideMatches, false, 'a chrome-switch label outside .author-workspace must not match');
  });
});
