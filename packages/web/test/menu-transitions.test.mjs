import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 10: popover menus fade and rise slightly on open
// instead of popping in. The entry transition covers the author topbar menus
// (.menu-popover inside <details>), the visual ⋯ action menu
// (.visual-action-menu [role=menu], conditionally rendered), and the data
// landing split-button dropdown (.data-menu-items inside <details>), all on
// the same 150ms beat as the dialog transition. Static under
// prefers-reduced-motion.
const style = (await readFile(new URL('../src/style.css', import.meta.url), 'utf8'))
  .replace(/@import\s+['"][^'"]+['"]\s*;/, '');
const dataSection = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');
const css = `${style}\n${dataSection}`;

test('menu open transitions are defined and respect reduced motion', () => {
  assert.match(css, /@keyframes menu-open/);
  assert.match(css, /details\[open\]\s+\.menu-popover\s*\{\s*animation:\s*menu-open/);
  assert.match(css, /\.visual-action-menu\s+\[role=menu\][^}]*animation:\s*menu-open/);
  assert.match(css, /details\[open\]\s+\.data-menu-items\s*\{\s*animation:\s*menu-open/);
  const reducedBlocks = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)];
  const reduced = reducedBlocks.map(m => m[1]).join('\n');
  assert.ok(reduced.includes('.menu-popover'), 'reduced-motion covers .menu-popover');
  assert.ok(reduced.includes('.visual-action-menu [role=menu]'), 'reduced-motion covers .visual-action-menu [role=menu]');
  assert.ok(reduced.includes('.data-menu-items'), 'reduced-motion covers .data-menu-items');
  assert.match(reduced, /animation:\s*none/);
});

describe('menu open transitions in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('open menus play the entry animation; a closed details menu does not', async () => {
    await page.setContent(`<style>${css}</style>` +
      `<details open class="author-menu"><summary>File</summary><div class="menu-popover">items</div></details>` +
      `<details class="author-menu"><summary>Edit</summary><div class="menu-popover">items</div></details>` +
      `<div class="visual-action-menu"><button>⋯</button><div role="menu"><button role="menuitem">a</button></div></div>` +
      `<details open class="data-menu"><summary>▾</summary><div class="data-menu-items"><button>Create data source</button></div></details>`);
    const actual = await page.evaluate(() => {
      const style = el => {
        const cs = getComputedStyle(el);
        return { name: cs.animationName, duration: cs.animationDuration };
      };
      const openPopover = document.querySelector('details[open] .menu-popover');
      const closedPopover = document.querySelector('details:not([open]) .menu-popover');
      const actionMenu = document.querySelector('.visual-action-menu [role=menu]');
      const dataMenu = document.querySelector('details[open] .data-menu-items');
      // Restart the entry animation deterministically: the 150ms animation may
      // already have finished by the time the page is evaluated.
      const restarted = el => el.getAnimations().some(a => a.animationName === 'menu-open');
      void openPopover.offsetWidth;
      return {
        openPopover: style(openPopover), closedPopover: style(closedPopover),
        actionMenu: style(actionMenu), dataMenu: style(dataMenu),
        restartOpen: restarted(openPopover), restartAction: restarted(actionMenu), restartData: restarted(dataMenu),
      };
    });
    assert.equal(actual.openPopover.name, 'menu-open');
    assert.equal(actual.openPopover.duration, '0.15s');
    assert.equal(actual.actionMenu.name, 'menu-open');
    assert.equal(actual.actionMenu.duration, '0.15s');
    assert.equal(actual.dataMenu.name, 'menu-open');
    assert.equal(actual.dataMenu.duration, '0.15s');
    assert.equal(actual.closedPopover.name, 'none');
    assert.ok(actual.restartOpen, 'author menu popover restarts the entry animation');
    assert.ok(actual.restartAction, 'visual action menu restarts the entry animation');
    assert.ok(actual.restartData, 'data split-button menu restarts the entry animation');
  });
});
