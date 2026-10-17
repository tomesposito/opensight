import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 9: modal dialogs fade and rise slightly on open
// instead of popping in. The entry transition lives in the global stylesheet so
// every native <dialog> (Create Analysis, Create dataset, Manage data, command
// palette, global search, shortcuts, settings) gets the same treatment, and it
// is static under prefers-reduced-motion.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('dialog open transitions are defined and respect reduced motion', () => {
  assert.match(css, /@keyframes dialog-open/);
  assert.match(css, /@keyframes dialog-backdrop-open/);
  assert.match(css, /dialog\[open\]\s*\{\s*animation:\s*dialog-open/);
  assert.match(css, /dialog\[open\]::backdrop\s*\{\s*animation:\s*dialog-backdrop-open/);
  const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
  assert.match(reduced, /dialog\[open\]/);
  assert.match(reduced, /animation:\s*none/);
});

describe('dialog open transition in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('an open dialog plays the entry animation; a closed one does not', async () => {
    await page.setContent(`<style>${css}</style><dialog open class="create-analysis-dialog">Hi</dialog><dialog class="create-analysis-dialog">Hidden</dialog>`);
    const actual = await page.evaluate(() => {
      const style = selector => {
        const cs = getComputedStyle(document.querySelector(selector));
        return { name: cs.animationName, duration: cs.animationDuration };
      };
      const open = document.querySelector('dialog[open]');
      const animations = open.getAnimations().map(a => ({ name: a.animationName, state: a.playState }));
      const backdrop = getComputedStyle(open, '::backdrop');
      return { open: style('dialog[open]'), closed: style('dialog:not([open])'), animations,
        backdrop: { name: backdrop.animationName, duration: backdrop.animationDuration } };
    });
    assert.equal(actual.open.name, 'dialog-open');
    assert.equal(actual.open.duration, '0.15s');
    assert.equal(actual.closed.name, 'none');
    assert.ok(actual.animations.some(a => a.name === 'dialog-open' && a.state === 'running'));
    assert.equal(actual.backdrop.name, 'dialog-backdrop-open');
    assert.equal(actual.backdrop.duration, '0.15s');
  });
});
