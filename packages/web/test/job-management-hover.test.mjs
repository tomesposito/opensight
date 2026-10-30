import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 60: hover feedback for the hosted Jobs page
// (.job-management in JobManagement.tsx — "Refresh jobs and history" and
// the per-row "History {id}" / "Run {id}" buttons). Static audit follow-on
// to slices 57/59: the page renders in <main> inside .app-shell, outside
// .author-workspace, .data-page, .collection-card and .admin-settings, so
// no :hover rule in any stylesheet reached its buttons — its only button
// rule set white-space/overflow-wrap — and hovering changed nothing while
// buttons on every other surface tint. The buttons now take #eef3fd —
// style.css's generic button hover tint (.author-workspace button:hover,
// the slice-59 .admin-settings buttons). Background only, so resting
// geometry is identical. Static (no animation), so no reduced-motion
// variant is needed; disabled buttons (the page's busy state) keep their
// flat resting state.
const css = styles['style.css'];

const buttonHover = css.match(/\.job-management button:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the job-management button hover rule exists with the app tint', () => {
  assert.ok(buttonHover, 'expected the job-management button hover rule');
  assert.match(buttonHover[1], /background:\s*#eef3fd/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(buttonHover, 'expected the job-management button hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(buttonHover[1]), 'hover must change background only');
});

test('the resting job-management button rule still reserves the wrapping the hover keeps', () => {
  const button = css.match(/\.job-management button\s*\{([^}]*)\}/);
  assert.ok(button, 'expected the job-management button resting rule');
  assert.match(button[1], /white-space:\s*normal/);
  assert.match(button[1], /overflow-wrap:\s*anywhere/);
});

test('the author and admin hover rules are untouched', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#eef3fd/), 'the author button hover rule must still be present');
  assert.ok(css.match(/\.admin-settings button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the admin-settings button hover rule must still be present');
});

defineHoverCases('job-management hover', {
  html: `<section class="job-management">
      <button id="refresh" type="button">Refresh jobs and history</button>
      <table><tbody><tr><td>job-1</td><td><button id="history" type="button">History job-1</button><button id="run" type="button">Run job-1</button><button id="off" type="button" disabled>History job-2</button></td></tr></tbody></table>
    </section>`,
  cases: [
    {
      target: '#refresh',
      rule: '.job-management button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(239, 239, 239)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      excluded: ['#off'],
    },
    {
      target: '#history',
      rule: '.job-management button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(239, 239, 239)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
    {
      target: '#run',
      rule: '.job-management button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(239, 239, 239)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
  ],
});
