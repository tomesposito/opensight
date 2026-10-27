import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 43: hover feedback for the Page-not-found
// "Go to Home" link. A fresh behavioral hover audit (real mouse hover with
// computed-style delta measurement, Chromium, demo route) used a
// whole-document selector set (header/nav included) with every <details>
// expanded, over 11 routes. Every zero-hover hit was explained except this
// one: opened-menu summaries rest at their hover/pressed tint, current-page
// nav links rest at their hover tint by design (slice-31 precedent), and
// the 13x13 favorites checkbox is a by-design native control (slices
// 33/37/38). The not-found link (any unknown route) measured
// transparent -> transparent with :hover applied and hit-test confirmed:
// hovering it changed nothing. The not-found section now carries the
// .not-found-page hook and the link takes the app-wide menu-item hover
// tint (#eaf3f7, slices 16/21/25/26/32). Paint-only: the rule changes the
// background, so resting geometry is identical and there is no animation
// to need a reduced-motion variant.
const chromeCss = styles['app-chrome.css'];
const appTsx = await readFile(new URL('../src/Application.tsx', import.meta.url), 'utf8');

const linkRule = chromeCss.match(/\.not-found-page\s+a:hover\s*\{([^}]*)\}/);

test('the not-found page section carries the hook the hover rule targets', () => {
  assert.match(appTsx, /<section className="not-found-page"><h1>Page not found<\/h1>/);
  assert.match(appTsx, /<AppLink to=\{\{ page: 'home' \}\} navigate=\{navigate\}>Go to Home<\/AppLink>/);
});

test('the not-found link has a hover state with the menu-item tint', () => {
  assert.ok(linkRule, 'expected .not-found-page a:hover');
  assert.match(linkRule[1], /background:\s*#eaf3f7/);
});

test('the not-found link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(linkRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|text-decoration/.test(linkRule[1]), 'hover must change background only');
});

test('the not-found link hover coexists with the other text-link hovers', () => {
  assert.ok(chromeCss.match(/\.folder-empty-state\s+a:hover\s*\{\s*background:\s*#eaf3f7/), 'the slice-32 folders about-link hover must still be present');
  assert.ok(chromeCss.match(/\.my-stuff-links\s+a:hover\s*\{\s*background:\s*#eaf3f7/), 'the slice-25 my-stuff quick-link hover must still be present');
  assert.ok(chromeCss.match(/\.recent-pages\s+a:hover\s*\{\s*background:\s*#eaf3f7/), 'the slice-26 recent-pages hover must still be present');
});

defineHoverCases('not-found-link hover', {
  html: `<section class="not-found-page"><h1>Page not found</h1><p>Choose a section in the navigation to continue.</p><a href="#/" id="a">Go to Home</a></section><a href="#/" id="outside">Outside link</a>`,
  cases: [
    {
      target: '#a',
      rule: '.not-found-page a:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: [{ target: '#outside', resting: { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(0, 0, 238)' } }],
    },
  ],
});
