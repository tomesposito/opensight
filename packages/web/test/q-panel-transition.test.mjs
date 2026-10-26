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

  // Issue #140: use the dashboard's actual grid and VisualCard structure,
  // including inline placements ending at column 37. An ordinary block fits
  // main even when the grid's 35 fixed gutters push its rightmost cards out.
  const card = (id, column, columns, row, table = false) => `<section id="${id}" class="visual-card" style="grid-column:${column} / span ${columns};grid-row:${row} / span 6">
    <header class="card-heading"><div class="card-titles"><h3>${id}</h3></div></header>
    <div class="visual-content">${table ? '<div class="table-scroll"><table><tbody><tr><td>Revenue</td><td>100</td></tr></tbody></table></div>' : '<div class="chart"></div>'}</div>
  </section>`;
  const panel = '<aside class="q-side-panel">Ask O</aside>';
  const shell = open => `<style>${css}\n${chromeCss}</style><div class="app-shell"><main><div class="dashboard-grid">${
    card('left', 1, 18, 1) + card('rightmost', 19, 18, 1) + card('rightmost-lower', 25, 12, 7) + card('table', 1, 36, 13, true)
  }</div></main>${open ? panel : ''}</div>`;
  const boxes = () => page.evaluate(async () => {
    // Let the 150ms shell transition and card entry animations settle.
    await new Promise(resolve => setTimeout(resolve, 300));
    const rect = element => {
      const box = element?.getBoundingClientRect();
      return box && { left: box.left, right: box.right, width: box.width, top: box.top, bottom: box.bottom, height: box.height };
    };
    const main = document.querySelector('.app-shell > main');
    const mainStyle = getComputedStyle(main);
    const grid = document.querySelector('.dashboard-grid');
    const gridStyle = getComputedStyle(grid);
    return {
      viewportWidth: document.documentElement.clientWidth,
      shellPaddingRight: getComputedStyle(document.querySelector('.app-shell')).paddingRight,
      main: rect(main),
      contentLeft: rect(main).left + parseFloat(mainStyle.paddingLeft) + parseFloat(mainStyle.borderLeftWidth),
      contentRight: rect(main).right - parseFloat(mainStyle.paddingRight) - parseFloat(mainStyle.borderRightWidth),
      grid: { ...rect(grid), display: gridStyle.display, gap: gridStyle.gap,
        columns: gridStyle.gridTemplateColumns.split(' ').length, scrollWidth: grid.scrollWidth, clientWidth: grid.clientWidth },
      cards: [...grid.children].map(element => ({ id: element.id, ...rect(element) })),
      charts: [...grid.querySelectorAll('.chart')].map(rect),
      panel: rect(document.querySelector('.q-side-panel')),
    };
  });

  function assertFits(actual, docked = false) {
    for (const [name, box] of [['grid', actual.grid], ...actual.cards.map(c => [c.id, c]), ...actual.charts.map((c, i) => [`chart ${i}`, c])]) {
      assert.ok(box.width > 0, `${name} must remain visible`);
      assert.ok(box.left >= actual.contentLeft - 1, `${name} must stay inside main's content left edge`);
      assert.ok(box.right <= actual.contentRight + 1, `${name} (${box.right}) must stay inside main's content right edge (${actual.contentRight})`);
      if (docked) assert.ok(box.right <= actual.panel.left + 1, `${name} must not extend under the panel`);
    }
    assert.ok(actual.grid.scrollWidth <= actual.grid.clientWidth + 1, 'the grid must have no horizontal overflow');
  }

  function assertDesktopGrid(actual) {
    assert.equal(actual.grid.display, 'grid');
    assert.equal(actual.grid.columns, 36, 'wide content keeps all 36 tracks');
    assert.equal(actual.grid.gap, '10px', 'wide content keeps its fixed 10px gutters');
    assert.equal(actual.cards[0].top, actual.cards[1].top, 'left and right cards remain side by side');
    assert.ok(Math.abs(actual.cards[1].right - actual.grid.right) <= 1, 'the fixture exercises the rightmost column');
  }

  function assertCompact(actual) {
    assert.equal(actual.grid.display, 'flex');
    assert.equal(actual.grid.gap, '16px');
    for (const [i, card] of actual.cards.entries()) {
      assert.ok(Math.abs(card.width - actual.grid.width) <= 1, `${card.id} must fill the compact width`);
      assert.ok(card.height >= 340, `${card.id} must keep the compact card height`);
      if (i) assert.ok(card.top >= actual.cards[i - 1].bottom + 15, 'compact cards must stack in document order');
    }
    assert.equal(actual.cards.at(-1).height, 340, 'compact tables keep a bounded scroll area');
    for (const chart of actual.charts) assert.ok(chart.height >= 235, 'compact charts keep their minimum height');
  }

  for (const width of [761, 900, 1280]) test(`at ${width}px the real dashboard fits before opening, while docked, and after closing`, async () => {
    await page.setViewportSize({ width, height: 800 });
    await page.setContent(shell(false));
    const initial = await boxes();
    assert.equal(initial.shellPaddingRight, '0px');
    assertFits(initial);
    if (width >= 900) assertDesktopGrid(initial);
    else assertCompact(initial);

    await page.evaluate(markup => document.querySelector('.app-shell').insertAdjacentHTML('beforeend', markup), panel);
    const open = await boxes();
    assert.equal(open.shellPaddingRight, '400px');
    assert.equal(Math.round(open.panel.width), 400);
    assert.ok(open.main.right <= open.panel.left + 1, `main (${open.main.right}) must not extend under the panel (${open.panel.left})`);
    assertFits(open, true);
    if (width === 1280) assertDesktopGrid(open);
    else assertCompact(open);
    if (width === 900) assert.equal(open.grid.width, open.viewportWidth - 168 - 400 - 48,
      '900px leaves 284px after rail, panel and padding, less any vertical scrollbar');

    // Closing the panel restores the full width.
    await page.evaluate(() => document.querySelector('.q-side-panel').remove());
    const closed = await boxes();
    assert.equal(closed.shellPaddingRight, '0px');
    assert.equal(closed.main.width - open.main.width, 400, 'main regains the reserved width on close');
    assertFits(closed);
    assert.deepEqual(closed.grid, initial.grid, 'closing restores the original grid geometry');
    assert.deepEqual(closed.cards, initial.cards, 'closing restores every original card placement');
  });

  test('compact layout follows available content width even without Ask O or a viewport change', async () => {
    await page.setViewportSize({ width: 1920, height: 800 });
    await page.setContent(shell(false));
    for (const width of [601, 600, 284, 601]) {
      await page.evaluate(width => { document.querySelector('main').style.width = `${width + 64}px`; }, width);
      const actual = await boxes();
      assert.equal(actual.grid.width, width, 'the container query excludes main padding');
      assertFits(actual);
      if (width > 600) assertDesktopGrid(actual);
      else assertCompact(actual);
    }
  });

  for (const width of [500, 760]) test(`at ${width}px the panel keeps overlay behavior and the dashboard remains compact`, async () => {
    await page.setViewportSize({ width, height: 800 });
    await page.setContent(shell(true));
    const small = await boxes();
    assert.equal(small.shellPaddingRight, '0px');
    assert.equal(Math.round(small.panel.width), 400);
    assert.ok(small.main.right > small.panel.left, 'on small screens the panel still floats over main');
    assertFits(small);
    assertCompact(small);
  });
});
