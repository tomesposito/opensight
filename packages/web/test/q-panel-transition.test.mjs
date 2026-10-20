import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 19: the Ask O side panel slides in from the right
// edge (fade + translateX(24px)) when it mounts instead of popping in one
// frame, on the same 150ms ease-out beat as the dialog (slice 9), popover
// (slice 10), toast (slice 11), and visual card (slice 13) entry transitions.
// The panel mounts only when opened ({open && <div className="q-side-panel">}),
// so the animation plays exactly once per open and never replays spuriously.
// Static under prefers-reduced-motion.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('Q side panel entry transition is defined and respects reduced motion', () => {
  assert.match(css, /@keyframes q-panel-enter/);
  assert.match(css, /@keyframes q-panel-enter\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateX\(24px\);\s*\}/);
  assert.match(css, /\.q-side-panel\s*\{[^}]*animation:\s*q-panel-enter\s+150ms\s+ease-out/);
  const reduced = css.slice(css.indexOf('@keyframes q-panel-enter'));
  assert.match(reduced, /prefers-reduced-motion/);
  const reducedBlock = css.slice(css.indexOf('prefers-reduced-motion', css.indexOf('@keyframes q-panel-enter')));
  assert.match(reducedBlock, /\.q-side-panel/);
  assert.match(reducedBlock, /animation:\s*none/);
});

describe('Q side panel entry transition in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('a mounted Q side panel plays the entry animation at 150ms', async () => {
    await page.setContent(`<style>${css}</style><div class="q-side-panel">ask q</div>`);
    const actual = await page.evaluate(() => {
      const panel = document.querySelector('.q-side-panel');
      const cs = getComputedStyle(panel);
      // Restart the entry animation deterministically: the 150ms animation
      // may already have finished by the time the page is evaluated.
      const parent = panel.parentNode, next = panel.nextSibling;
      parent.removeChild(panel); void parent.offsetWidth; parent.insertBefore(panel, next);
      const restarted = panel.getAnimations().some(a => a.animationName === 'q-panel-enter');
      return { name: cs.animationName, duration: cs.animationDuration, restarted };
    });
    assert.equal(actual.name, 'q-panel-enter');
    assert.equal(actual.duration, '0.15s');
    assert.ok(actual.restarted);
  });
});
