import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

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
const chromeCss = styles['app-chrome.css'];
const styleCss = styles['style.css'];

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

defineHoverCases('fixture-picker-label hover', {
  html: `<div class="app-shell"><header class="app-header product-header"><a class="brand" href="#/home">OpenSight</a><label class="fixture-picker" id="fpLabel">Definition example<select><option>TotalDeathByCountry</option></select></label></header><main><label class="fixture-picker" id="outsideLabel">Other<select><option>x</option></select></label><header class="product-header"><label id="plainLabel">Plain</label></header></main></div>`,
  cases: [
    {
      target: '#fpLabel',
      rule: '.product-header .fixture-picker:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(208, 224, 232)' },
      hovered: { backgroundColor: 'rgb(54, 87, 100)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#outsideLabel', '#plainLabel'],
    },
  ],
});
