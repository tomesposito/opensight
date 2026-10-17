import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 13: new visual cards on the sheet canvas fade and
// rise slightly when they appear instead of popping in, on the same 150ms
// beat as the dialog (slice 9), popover (slice 10), and toast (slice 11)
// entry transitions. The animation plays when the card mounts (a freshly
// added visual, or a sheet/dashboard first rendering its cards); cards do
// not remount on field edits or recompiles, so it never replays spuriously.
// Static under prefers-reduced-motion.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('visual card entry transition is defined and respects reduced motion', () => {
  assert.match(css, /@keyframes visual-enter/);
  assert.match(css, /\.visual-card\s*\{\s*animation:\s*visual-enter/);
  const reduced = css.slice(css.indexOf('@keyframes visual-enter'));
  assert.match(reduced, /prefers-reduced-motion/);
  const reducedBlock = css.slice(css.indexOf('prefers-reduced-motion', css.indexOf('@keyframes visual-enter')));
  assert.match(reducedBlock, /\.visual-card/);
  assert.match(reducedBlock, /animation:\s*none/);
});

describe('visual card entry transition in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('a mounted visual card plays the entry animation at 150ms', async () => {
    await page.setContent(`<style>${css}</style><section class="visual-card">chart</section>`);
    const actual = await page.evaluate(() => {
      const card = document.querySelector('.visual-card');
      const cs = getComputedStyle(card);
      // Restart the entry animation deterministically: the 150ms animation
      // may already have finished by the time the page is evaluated.
      const parent = card.parentNode, next = card.nextSibling;
      parent.removeChild(card); void parent.offsetWidth; parent.insertBefore(card, next);
      const restarted = card.getAnimations().some(a => a.animationName === 'visual-enter');
      return { name: cs.animationName, duration: cs.animationDuration, restarted };
    });
    assert.equal(actual.name, 'visual-enter');
    assert.equal(actual.duration, '0.15s');
    assert.ok(actual.restarted);
  });
});
