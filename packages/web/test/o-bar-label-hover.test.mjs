import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

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
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

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

describe('Ask O panel question label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry, and labels outside the panel o-bar are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="q-side-panel"><header class="q-panel-heading"><h2>ASK O</h2></header><div class="q-panel-content"><section class="o-entry"><form class="o-bar"><label id="panelLabel" for="o-question">Ask a question</label><input id="o-question" type="search"/><button type="submit">Ask</button></form><label id="plainPanelLabel">Plain</label></section></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="q-side-panel"><div class="q-panel-content"><section class="o-entry"><form class="o-bar"><label id="darkLabel" for="o-question-dark">Ask a question</label><input id="o-question-dark" type="search"/></form></section></div></div></div>`
      + `<div class="author-workspace"><div class="author-menu"><form class="o-bar"><label id="menuLabel" for="o-question-menu">Ask a question</label><input id="o-question-menu" type="search"/></form></div></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const rule = all.find(r => norm(r) === '.q-side-panel .o-bar label:hover') ?? null;
      const inputRule = all.find(r => norm(r) === '.q-side-panel .o-bar input:hover:not(:disabled)') ?? null;
      const el = id => document.querySelector(`#${id}`);
      const measure = (target, found) => {
        const rest = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        // Apply the declaration block as-is: the background value is a
        // var() shorthand, which does not expand into longhands (the
        // slice-58 panel input test uses the same mechanism).
        if (found) target.style.cssText = found.style.cssText;
        const hovered = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        target.removeAttribute('style');
        return { rest, hovered };
      };
      return {
        found: !!rule,
        props: rule ? [...rule.style] : [],
        label: rule ? measure(el('panelLabel'), rule) : null,
        darkLabel: rule ? measure(el('darkLabel'), rule) : null,
        input: inputRule ? measure(el('o-question'), inputRule) : null,
        menuMatches: el('menuLabel').matches('.q-side-panel .o-bar label'),
        plainMatches: el('plainPanelLabel').matches('.q-side-panel .o-bar label'),
      };
    });
    assert.equal(actual.found, true, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.label.rest.background, 'rgba(0, 0, 0, 0)', 'label rest');
    assert.equal(actual.label.hovered.background, 'rgb(237, 247, 247)', 'label hover (var fallback outside author chrome)');
    assert.notEqual(actual.label.rest.background, actual.label.hovered.background);
    assert.equal(actual.label.rest.color, actual.label.hovered.color, 'label colour unchanged on hover');
    assert.equal(actual.label.rest.box, actual.label.hovered.box, 'label geometry');
    assert.equal(actual.darkLabel.rest.background, 'rgba(0, 0, 0, 0)', 'dark label rest');
    assert.equal(actual.darkLabel.hovered.background, 'rgb(41, 63, 85)', 'dark label hover (var resolves to the dark chrome menu hover, like the panel buttons)');
    assert.equal(actual.input.hovered.background, 'rgb(237, 247, 247)', 'the slice-58 input hover is unchanged');
    assert.equal(actual.menuMatches, false, 'the visually hidden author-menu label must be out of scope');
    assert.equal(actual.plainMatches, false, 'a label in the panel outside .o-bar must be out of scope');
  });
});
