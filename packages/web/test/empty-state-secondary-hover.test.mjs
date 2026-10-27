import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 19: hover feedback for .empty-state-secondary. A
// fresh interactive-state audit (home, analyses, dashboards, data, create
// dialogs) found every reachable control already carries a hover state after
// slices 8/16/17/18 — except the secondary text-button used by empty states
// ("Try sample data" on the local home empty state, "Refresh drafts" on the
// analyses empty state). It had no :hover rule at all: hovering changed
// nothing. It now takes the established menu-item hover tint (#eaf3f7, the
// same tint the data-page buttons and rail menus use) as a subtle background
// pill. The tint works in both color contexts the button renders in (default
// #176fa1 and the app-shell #126e76 override) without touching the text
// color. Background and border-radius do not affect layout, so the resting
// geometry is identical — no shift. The state is instantaneous, so no
// prefers-reduced-motion variant is needed; the global button :active 1px
// pressed shift (slice 14) already composes with it.
const css = styles['style.css'];

test('empty-state secondary buttons give hover feedback', () => {
  const rule = css.match(
    /\.empty-page-state\s+\.empty-state-secondary:hover\s*\{([^}]*)\}/,
  );
  assert.ok(rule, 'expected .empty-page-state .empty-state-secondary:hover');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover pill cannot shift layout', () => {
  const hover = css.match(
    /\.empty-page-state\s+\.empty-state-secondary:hover\s*\{([^}]*)\}/,
  );
  assert.ok(hover);
  assert.ok(
    !/padding|margin|border-width|font-size|color|text-decoration/.test(hover[1]),
    'hover must change paint only — no geometry or text-style changes',
  );
});

test('the resting text-button styling is unchanged', () => {
  const base = css.match(
    /\.empty-page-state\s+\.empty-state-secondary\s*\{([^}]*)\}/,
  );
  assert.ok(base, 'expected the base .empty-state-secondary rule');
  assert.match(base[1], /background:\s*transparent/);
  assert.match(base[1], /text-decoration:\s*underline/);
  assert.match(base[1], /color:\s*#176fa1/);
});

defineHoverCases('empty-state secondary controls', {
  html: `<section class="empty-page-state"><button id="default" class="empty-state-secondary">Try sample data</button></section>
    <div class="app-shell"><section class="empty-page-state"><button id="shell" class="empty-state-secondary">Refresh drafts</button></section></div>`,
  cases: ['#default', '#shell'].map(target => ({
    target, rule: '.empty-page-state .empty-state-secondary:hover',
    resting: { backgroundColor: 'rgba(0, 0, 0, 0)', color: target === '#default' ? 'rgb(23, 111, 161)' : 'rgb(18, 110, 118)' },
    hovered: { backgroundColor: 'rgb(234, 243, 247)' },
    unchanged: ['color', 'textDecorationLine'],
    paintOnly: true,
  })),
});
