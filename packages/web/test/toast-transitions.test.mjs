import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 11: toast notifications fade and rise on arrival
// instead of popping in, on the same 150ms ease-out beat as the dialog (slice 9)
// and popover (slice 10) entry transitions, and static under
// prefers-reduced-motion. The existing .toast-leaving opacity transition keeps
// handling the exit fade.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('toast enter transition is defined and respects reduced motion', () => {
  assert.match(css, /@keyframes toast-enter/);
  assert.match(css, /\.toast\s*\{[^}]*animation:\s*toast-enter/);
  const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
  assert.match(reduced, /\.toast/);
  assert.match(reduced, /animation:\s*none/);
});

describe('toast enter transition in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('a mounted toast plays the entry animation', async () => {
    await page.setContent(`<style>${css}</style><div class="toast-host"><div class="toast"><span>Hello</span><button type="button">×</button></div></div>`);
    const actual = await page.evaluate(() => {
      const toast = document.querySelector('.toast');
      const cs = getComputedStyle(toast);
      // Restart the entry animation deterministically: the 150ms animation may
      // already have finished by the time the page is evaluated.
      toast.classList.remove('toast'); void toast.offsetWidth; toast.classList.add('toast');
      const restarted = toast.getAnimations().some(a => a.animationName === 'toast-enter');
      return { name: cs.animationName, duration: cs.animationDuration, restarted };
    });
    assert.equal(actual.name, 'toast-enter');
    assert.equal(actual.duration, '0.15s');
    assert.ok(actual.restarted);
  });
});
