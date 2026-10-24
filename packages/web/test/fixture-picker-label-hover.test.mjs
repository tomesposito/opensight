import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 129: hover feedback for the fixture-picker label
// (.product-header .fixture-picker in Application.tsx, rendered as children
// of AppNavigation inside header.app-header.product-header — the label text
// "Definition example" wrapping the fixture select). Slice 33 hovered the
// select inside it (#365764 + white text), and the brand link and account
// summary in the same header hover #365764, but the label itself matched no
// :hover rule: every label :hover rule in the cascade is scoped to a panel,
// dialog or surface elsewhere, so the label rested transparent and hovering
// its text or the gap between text and select changed nothing, while only
// the select inside it tinted. A CSSOM probe with all five real stylesheets
// (1,403 rules) in the real ancestor context (app-shell >
// header.product-header) confirmed zero matching :hover rules for the label
// and a transparent rest, while the select matched the slice-33 rule alone.
// The resting rules (.fixture-picker { display: flex; gap: 12px; } in
// style.css, .product-header .fixture-picker { color: #d0e0e8; } in
// app-chrome.css) make the label a visible surface (text line, gap, field).
// The label now takes the header's established hover tint #365764 — the
// tint of the select inside it and of the brand/account controls beside
// it — so no new colour is introduced and label and field read as one
// surface. No colour change: the label text is already the light #d0e0e8,
// readable on #365764. Background only, so resting geometry is identical
// and there is no animation.
const chromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = chromeCss.match(/^\.product-header \.fixture-picker:hover\s*\{([^}]*)\}/m);

test('the fixture-picker label hover rule exists and uses the header hover tint', () => {
  assert.ok(labelRule, 'expected the .product-header .fixture-picker:hover rule');
  assert.match(labelRule[1], /background:\s*#365764/);
});

test('the hover tint matches the hovers of the controls in the same header, so no new colour is introduced', () => {
  assert.ok(chromeCss.match(/\.product-header \.fixture-picker select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#365764/), 'the slice-33 fixture-picker select hover must remain #365764');
  assert.ok(chromeCss.match(/\.product-header \.brand:hover\s*\{[^}]*background:\s*#365764/), 'the brand hover must remain #365764');
  assert.ok(chromeCss.match(/\.account-menu summary:hover\s*\{[^}]*background:\s*#365764/), 'the account-menu summary hover must remain #365764');
});

test('the fixture-picker label hover rule is paint-only: resting geometry and text colour cannot shift', () => {
  assert.ok(labelRule, 'expected the fixture-picker label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
});

test('the resting fixture-picker rules are preserved', () => {
  assert.ok(chromeCss.match(/\.product-header \.fixture-picker\s*\{[^}]*color:\s*#d0e0e8/), 'the resting header fixture-picker rule must remain');
  assert.ok(styleCss.match(/\.fixture-picker\s*\{[^}]*display:\s*flex[^}]*gap:\s*12px/), 'the resting fixture-picker flex rule must remain');
  assert.ok(chromeCss.match(/\.product-header \.fixture-picker select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#365764[^}]*color:\s*#fff/), 'the slice-33 select hover must remain');
});

describe('Fixture-picker label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry, and labels outside the header fixture-picker are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="app-shell"><header class="app-header product-header"><a class="brand" href="#/home">OpenSight</a><label class="fixture-picker" id="fpLabel">Definition example<select><option>TotalDeathByCountry</option></select></label></header><main><label class="fixture-picker" id="outsideLabel">Other<select><option>x</option></select></label><header class="product-header"><label id="plainLabel">Plain</label></header></main></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const rule = all.find(r => norm(r) === '.product-header .fixture-picker:hover') ?? null;
      const el = id => document.querySelector(`#${id}`);
      const measure = (target, found) => {
        const rest = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        if (found) { for (const prop of found.style) target.style.setProperty(prop, found.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        target.removeAttribute('style');
        return { rest, hovered };
      };
      return {
        found: !!rule,
        props: rule ? [...rule.style] : [],
        label: rule ? measure(el('fpLabel'), rule) : null,
        outsideMatches: el('outsideLabel').matches('.product-header .fixture-picker'),
        plainMatches: el('plainLabel').matches('.product-header .fixture-picker'),
      };
    });
    assert.equal(actual.found, true, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.label.rest.background, 'rgba(0, 0, 0, 0)', 'label rest');
    assert.equal(actual.label.hovered.background, 'rgb(54, 87, 100)', 'label hover');
    assert.notEqual(actual.label.rest.background, actual.label.hovered.background);
    assert.equal(actual.label.rest.color, 'rgb(208, 224, 232)', 'label rest colour');
    assert.equal(actual.label.rest.color, actual.label.hovered.color, 'label colour unchanged on hover');
    assert.equal(actual.label.rest.box, actual.label.hovered.box, 'label geometry');
    assert.equal(actual.outsideMatches, false, 'a fixture-picker label outside .product-header must be out of scope');
    assert.equal(actual.plainMatches, false, 'a plain label inside .product-header must be out of scope');
  });
});
