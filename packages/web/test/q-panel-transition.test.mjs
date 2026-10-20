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
//
// Issue #136 / slice 65: the panel docks instead of overlaying. While it is
// open the app shell reserves its 400px (app-chrome.css :has() rule), so
// <main> compresses and nothing is covered; the overlay drop shadow is gone
// on desktop (border-left only) and closing restores the full width on the
// same 150ms beat. Below the 760px shell breakpoint the panel is
// effectively full-width and keeps its overlay behavior and shadow.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const chromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');

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

test('Q side panel docks: the shell reserves its width on the same 150ms beat', () => {
  assert.match(chromeCss, /\.app-shell\s*\{\s*transition:\s*padding-right\s+150ms\s+ease-out;\s*\}/);
  assert.match(chromeCss, /@media \(min-width: 761px\)\s*\{\s*\.app-shell:has\(\.q-side-panel\)\s*\{\s*padding-right:\s*400px;\s*\}\s*\}/);
  const reducedBlock = chromeCss.slice(chromeCss.indexOf('prefers-reduced-motion', chromeCss.indexOf('.app-shell { transition:')));
  assert.match(reducedBlock, /\.app-shell\s*\{\s*transition:\s*none;\s*\}/);
});

test('docked Q side panel keeps its border-left and drops the overlay shadow', () => {
  const base = css.match(/\.q-side-panel\s*\{([^}]*)\}/)[1];
  assert.match(base, /border-left:\s*1px solid/);
  assert.doesNotMatch(base, /box-shadow/);
  // The shadow survives only where the panel still floats (small screens).
  assert.match(css, /@media \(max-width: 760px\)\s*\{\s*\.q-side-panel\s*\{\s*box-shadow:\s*-4px 0 16px/);
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

describe('docked Q side panel geometry in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  const shell = panel => `<style>${css}\n${chromeCss}</style><div class="app-shell"><main><div class="chart-probe" style="height:80px"></div></main>${panel ? '<aside class="q-side-panel">Ask O</aside>' : ''}</div>`;
  const boxes = () => page.evaluate(async () => {
    // Let the 150ms shell transition settle before measuring.
    await new Promise(resolve => setTimeout(resolve, 300));
    const rect = selector => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box && { left: box.left, right: box.right, width: box.width };
    };
    return {
      shellPaddingRight: getComputedStyle(document.querySelector('.app-shell')).paddingRight,
      main: rect('.app-shell > main'),
      chart: rect('.chart-probe'),
      panel: rect('.q-side-panel'),
    };
  });

  test('at a desktop viewport the panel docks: main compresses and no box overlaps it', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(shell(true));
    const open = await boxes();
    assert.equal(open.shellPaddingRight, '400px');
    assert.equal(Math.round(open.panel.width), 400);
    assert.ok(open.main.right <= open.panel.left + 1, `main (${open.main.right}) must not extend under the panel (${open.panel.left})`);
    assert.ok(open.chart.right <= open.panel.left + 1, 'the chart must sit fully inside the compressed width');
    assert.ok(open.chart.right <= open.main.right + 1, 'the chart must stay inside main');
    // Closing the panel restores the full width.
    await page.evaluate(() => document.querySelector('.q-side-panel').remove());
    const closed = await boxes();
    assert.equal(closed.shellPaddingRight, '0px');
    assert.ok(closed.main.width > open.main.width, 'main regains the reserved width on close');
  });

  test('below the 760px breakpoint the panel keeps overlay behavior', async () => {
    await page.setViewportSize({ width: 500, height: 800 });
    await page.setContent(shell(true));
    const small = await boxes();
    assert.equal(small.shellPaddingRight, '0px');
    assert.equal(Math.round(small.panel.width), 400);
    assert.ok(small.main.right > small.panel.left, 'on small screens the panel still floats over main');
  });
});
