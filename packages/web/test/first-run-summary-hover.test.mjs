import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 70: hover feedback for the first-run page's
// "Required API environment variables" disclosure summary (.first-run
// summary in FirstRun.tsx, inside .first-run-setup). Every other
// first-run control hovers to the surface tint (#eaf3f4): its buttons
// via .first-run button:hover and its docs links via slice 63. A
// summary is neither a button nor a link, and every summary:hover rule
// in the cascade is scoped elsewhere (.author-workspace, .prep-*,
// .calculation-dialog, .card-footer, .account-menu, .data-*), so no
// hover rule reached this one — its only rules gave font weight, line
// height and the global cursor/:active press — and hovering it changed
// nothing while every other control on the page tinted. The page is
// standalone (SessionGate renders it before any session, outside
// .app-shell), so no app-shell rule reaches it either. It now takes
// the first-run surface's own hover tint (#eaf3f4). Background only,
// so resting geometry is identical and there is no animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/\.first-run\s+summary:hover\s*\{([^}]*)\}/);

test('the first-run summary has a hover state with the surface tint', () => {
  assert.ok(rule, 'expected the .first-run summary hover rule');
  assert.match(rule[1], /background:\s*#eaf3f4/);
});

test('the summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting first-run summary rules are preserved', () => {
  assert.ok(styleCss.match(/\.first-run summary\s*\{[^}]*font-weight:\s*650; line-height:\s*1\.6/), 'the summary resting rule must remain');
  assert.ok(styleCss.match(/\.first-run details\s*\{[^}]*border-top:\s*1px solid #d1e0e5/), 'the details resting rule must remain');
});

test('the neighbouring first-run hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.first-run button:hover:not\(:disabled\), \.fixture-demo-banner button:hover\s*\{[^}]*background:\s*#eaf3f4/), 'the first-run button hover must remain');
  assert.ok(styleCss.match(/\.first-run \.first-run-primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#0d5960/), 'the first-run primary hover must remain');
  assert.ok(styleCss.match(/\.first-run-docs a:hover\s*\{[^}]*background:\s*#eaf3f4/), 'slice 63 docs-link hover must remain');
});

defineHoverCases('first-run-summary hover', {
  html: `<div class="first-run"><main class="first-run-main"><div class="first-run-paths"><section class="first-run-setup"><details><summary id="s">Required API environment variables</summary></details></section></div></main></div>`
      + `<details><summary id="outside">Outside summary</summary></details>`,
  cases: [
    {
      target: '#s',
      rule: '.first-run summary:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 244)' },
      paintOnly: true,
      excluded: ['#outside'],
    },
  ],
});
