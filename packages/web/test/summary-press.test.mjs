import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #108 polish slice 15: tactile pressed feedback for <summary>
// dropdown toggles (shell account menu, split-button carets, data row
// menus) — the same 1px shift slice 14 gave buttons. The state is
// instantaneous (no animation), so no prefers-reduced-motion variant is
// required. Behavioral verification (real mouse-down) is covered by the
// slice's Playwright before/after captures — the headless test driver
// exposes no trusted input events to activate :active.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('summary pressed-state rule is defined', () => {
  const rule = css.match(/summary:active\s*\{([^}]*)\}/);
  assert.ok(rule, 'expected a summary:active rule');
  assert.match(rule[1], /transform:\s*translateY\(1px\)/);
});

test('no animation accompanies the pressed state (nothing to reduce)', () => {
  const rule = css.match(/summary:active\s*\{([^}]*)\}/);
  assert.ok(rule);
  assert.doesNotMatch(rule[1], /transition|animation/);
});

test('summary pressed shift coexists with the author-menu pressed style', () => {
  // Author menus keep their existing background/inset-shadow pressed
  // feedback; the shift must compose with it, not replace it.
  const author = css.match(
    /\.author-menu\s+summary:active,\s*\.author-menu\s+details\[open\]\s*>\s*summary\s*\{([^}]*)\}/,
  );
  assert.ok(author, 'expected the author-menu summary pressed rule to remain');
  assert.match(author[1], /background:/);
});
