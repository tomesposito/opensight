import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #108 polish slice 14: tactile pressed feedback. Buttons shift 1px
// while pressed so clicks feel deliberate; disabled buttons are excluded.
// The state is instantaneous (no animation), so no prefers-reduced-motion
// variant is required. Behavioral verification (real mouse-down) is covered
// by the slice's Playwright before/after captures — the headless test driver
// exposes no trusted input events to activate :active.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('button pressed-state rule is defined and excludes disabled buttons', () => {
  const rule = css.match(/button:active:not\(:disabled\)\s*\{([^}]*)\}/);
  assert.ok(rule, 'expected a button:active:not(:disabled) rule');
  assert.match(rule[1], /transform:\s*translateY\(1px\)/);
});

test('no animation accompanies the pressed state (nothing to reduce)', () => {
  const rule = css.match(/button:active:not\(:disabled\)\s*\{([^}]*)\}/);
  assert.ok(rule);
  assert.doesNotMatch(rule[1], /transition|animation/);
});
