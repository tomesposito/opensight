import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 32: hover feedback for the folders "About folders
// and sharing" link. A fresh behavioral hover audit (real mouse hover with
// computed-style delta measurement, Chromium, demo-mode bridge) re-audited
// the landing routes first (0 candidates: the landing-surface hover thread
// stays complete since slice 29) and then the top-level offline-demo routes,
// finding `.folder-empty-state a` (My folders and Shared folders pages) as
// the last user-facing control with zero hover state: hovering the link
// changed nothing. It shares its teal resting color (#126e76) with the
// slice-25 my-stuff quick links and now takes the same app-wide menu-item
// hover tint (#eaf3f7, slices 16/21/25/26). Paint-only: the rule changes the
// background, so resting geometry is identical and there is no animation to
// need a reduced-motion variant.
const chromeCss = styles['app-chrome.css'];

const linkRule = chromeCss.match(/\.folder-empty-state\s+a:hover\s*\{([^}]*)\}/);

test('the folders about-link has a hover state with the menu-item tint', () => {
  assert.ok(linkRule, 'expected .folder-empty-state a:hover');
  assert.match(linkRule[1], /background:\s*#eaf3f7/);
});

test('the about-link hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(linkRule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|text-decoration/.test(linkRule[1]), 'hover must change background only');
});

test('the about-link resting rule keeps the teal text color the hover preserves', () => {
  const base = chromeCss.match(/\.my-stuff-links\s+a,\s*\.folder-empty-state\s+a\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the shared resting color rule');
  assert.match(base[1], /color:\s*#126e76/);
  assert.ok(!/background:/.test(base[1]), 'resting rule must not set a background');
});

defineHoverCases('folders-about-link hover', {
  html: `<section class="collection-page folder-page"><div class="collection-card folder-empty-state"><p>Folders organize analyses and dashboards.</p><a href="#/admin/organization" id="a">About folders and sharing</a></div></section>`,
  cases: [
    {
      target: '#a',
      rule: '.folder-empty-state a:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
