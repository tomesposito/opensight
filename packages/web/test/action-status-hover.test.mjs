import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 61: hover feedback for the Dashboard's
// .action-status bar ("Reset actions" button in Dashboard.tsx). Static
// audit follow-on to slices 57/59/60: the bar renders in <main> inside
// .app-shell, outside .author-workspace, .data-page, .collection-card and
// .admin-settings, so no :hover rule in any stylesheet reached its button
// — its only rule (.action-status, .drill-navigation) sets layout — and
// hovering changed nothing while buttons on every other surface tint.
// The button now takes #edf7f7 — style.css's generic button hover tint
// (.author-workspace button:hover, the slice-60 .job-management button).
// The Author instance of .action-status already takes the same tint from
// the author rule, which also sets its border-color and whose dark-chrome
// variant has higher specificity, so it is unchanged in effect.
// Background only, so resting geometry is identical. Static (no
// animation), so no reduced-motion variant is needed; the disabled state
// (no active selection) keeps its flat resting state.
const css = styles['style.css'];

const buttonHover = css.match(/\.action-status button:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the action-status button hover rule exists with the app tint', () => {
  assert.ok(buttonHover, 'expected the action-status button hover rule');
  assert.match(buttonHover[1], /background:\s*#edf7f7/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(buttonHover, 'expected the action-status button hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(buttonHover[1]), 'hover must change background only');
});

test('the resting action-status layout rule is preserved', () => {
  const bar = css.match(/\.action-status, \.drill-navigation\s*\{([^}]*)\}/);
  assert.ok(bar, 'expected the action-status resting layout rule');
  assert.match(bar[1], /display:\s*flex/);
  assert.match(bar[1], /align-items:\s*center/);
});

test('the author and job-management hover rules are untouched', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#edf7f7/), 'the author button hover rule must still be present');
  assert.ok(css.match(/\.job-management button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the job-management button hover rule must still be present');
});

defineHoverCases('action-status hover', {
  html: `<div class="action-status">
      <button id="reset" type="button">Reset actions</button><span role="status">1 active selection(s)</span>
      <button id="off" type="button" disabled>Reset actions</button>
    </div>`,
  cases: [
    {
      target: '#reset',
      rule: '.action-status button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(239, 239, 239)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      excluded: ['#off'],
    },
  ],
});
