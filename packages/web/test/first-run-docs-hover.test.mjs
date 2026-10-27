import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 63: hover feedback for the first-run docs
// links (.first-run-docs a in FirstRun.tsx — the "Setup guides" row:
// First-run guide / Hosted authentication / Custom verifier /
// Architecture and limits). Static audit follow-on to slices 51/55/56/62:
// the first-run page is standalone — SessionGate renders it before any
// session exists, outside .app-shell — so no app-shell, author or data
// hover rule reaches it, and style.css gave both of its buttons a hover
// step (.first-run button:hover -> #eaf3f4, .first-run-primary:hover ->
// #0d5960) while the docs links' only rule set color/underline-offset
// and hovering changed nothing, unlike links on every other surface
// (fixture-notice, my-stuff, recent-pages, folder and not-found links
// all step on hover). The links now take the first-run surface's own
// button hover tint (#eaf3f4) as a background step, underline kept.
// Background only, so resting geometry is identical. Static (no
// animation), so no reduced-motion variant is needed.
const css = styles['style.css'];

const linkHover = css.match(/\.first-run-docs a:hover\s*\{([^}]*)\}/);

test('the first-run docs link hover rule exists with the surface tint', () => {
  assert.ok(linkHover, 'expected the first-run-docs link hover rule');
  assert.match(linkHover[1], /background:\s*#eaf3f4/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(linkHover, 'expected the first-run-docs link hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(linkHover[1]), 'hover must change background only');
});

test('the resting first-run-docs rules are preserved', () => {
  const nav = css.match(/\.first-run-docs\s*\{([^}]*)\}/);
  assert.ok(nav, 'expected the first-run-docs resting rule');
  assert.match(nav[1], /display:\s*flex/);
  const link = css.match(/\.first-run-docs a\s*\{([^}]*)\}/);
  assert.ok(link, 'expected the first-run-docs link resting rule');
  assert.match(link[1], /color:\s*#126e76/);
  assert.match(link[1], /text-underline-offset:\s*3px/);
});

test('the neighbouring first-run hover rules are untouched', () => {
  assert.ok(css.match(/\.first-run button:hover:not\(:disabled\), \.fixture-demo-banner button:hover\s*\{[^}]*background:\s*#eaf3f4/), 'the first-run button hover rule must still be present');
  assert.ok(css.match(/\.first-run \.first-run-primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#0d5960/), 'the first-run primary hover rule must still be present');
});

defineHoverCases('first-run-docs hover', {
  html: `<div class="first-run"><main class="first-run-main">
      <nav class="first-run-docs" aria-label="Setup documentation"><strong>Setup guides</strong><a id="guide" href="https://example.invalid/first-run.md">First-run guide</a><a href="https://example.invalid/h2.md">Hosted authentication</a><span>Repository links open online.</span></nav>
    </main></div>`,
  cases: [
    {
      target: '#guide',
      rule: '.first-run-docs a:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 244)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
