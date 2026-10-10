import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalysisSettings } from '../build/test/AnalysisSettings.js';
import { emptyDraft } from '../build/test/authoring.js';
import { Author } from '../build/test/Author.js';
import { chromiumPage } from './chromium.mjs';

const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
describe('toolbar/header geometry in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });
  async function render(width, theme, inApp = true) {
    await page.setViewportSize({ width, height: 900 });
    // Match the capture driver's overlay scrollbars, so viewport width equals
    // content width on systems whose headless Chromium uses classic scrollbars.
    await page.setContent(`<style>${css}\nhtml { scrollbar-width: none; }</style><main class="author-main">${renderToStaticMarkup(createElement(Author, { inApp }))}</main>`);
    await page.evaluate(theme => { document.querySelector('.author-workspace').dataset.chrome = theme; }, theme);
  }
  for (const theme of ['light', 'dark']) for (const width of [1440, 1100, 760, 390]) {
    test(`${theme} at ${width}px: compact bands, aligned controls and contained menus`, async () => {
      await render(width, theme);
      const result = await page.evaluate(() => {
        const rect = node => { const { x, y, width, height, right, bottom } = node.getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
        const top = document.querySelector('.author-topbar'), nav = document.querySelector('.author-menu');
        const controls = [...nav.querySelectorAll(':scope > details > summary, :scope > button, .chrome-switch select')];
        const positions = controls.map(rect);
        const menus = [...nav.querySelectorAll('details')].map(node => {
          node.open = true; const box = rect(node.querySelector('.menu-popover')); node.open = false; return box;
        });
        return { top: rect(top), nav: rect(nav), positions, menus,
          title: rect(top.querySelector('input')), q: rect(nav.querySelector('.q-trigger')),
          fontSizes: controls.map(n => getComputedStyle(n).fontSize),
          scrollWidth: document.documentElement.scrollWidth,
          docks: [...document.querySelector('.author-layout').children].map(rect),
        };
      });
      assert.equal(result.scrollWidth, width);
      assert.equal(result.top.height, 32);
      assert.equal(result.title.height, 28);
      assert.equal(result.title.x, 16, 'no orphan brand separator in the app');
      assert.equal(result.nav.y, result.top.bottom, 'bands meet without a gap');
      assert.ok(result.fontSizes.every(size => size === '12px'));
      for (const box of [...result.positions, ...result.menus]) {
        assert.ok(box.x >= 0 && box.right <= width, `control/popover fits ${JSON.stringify(box)}`);
      }
      for (const box of result.menus) {
        assert.ok(box.bottom <= 900, 'menu remains within the viewport');
        if (width <= 760) assert.ok(box.height <= 360, 'wrapped toolbars leave room for a scrollable menu');
      }
      for (const box of result.positions) {
        assert.ok(box.y >= result.nav.y && box.bottom <= result.nav.bottom);
        assert.ok(box.height >= 28);
      }
      if (width === 1440) {
        assert.equal(result.nav.height, 36);
        const center = result.nav.y + result.nav.height / 2;
        assert.ok(result.positions.every(box => Math.abs(box.y + box.height / 2 - center) < 1));
        assert.ok(result.q.width >= 220 && result.q.width <= 280);
        assert.ok(Math.abs(result.q.x + result.q.width / 2 - width / 2) < 48, 'Q stays near the center');
        assert.deepEqual(result.docks.map(box => box.width), [190, 216, 758, 220]);
      }
    });
  }
  for (const theme of ['light', 'dark']) for (const width of [1440, 1100, 760, 390]) test(`settings at ${width}px ${theme}: reasons cannot move Apply/Cancel during a click`, async () => {
    await render(width, theme);
    await page.evaluate(markup => {
      document.querySelector('.author-workspace').insertAdjacentHTML('beforeend', markup);
      document.querySelector('dialog').showModal();
    }, renderToStaticMarkup(createElement(AnalysisSettings, { draft: emptyDraft(), dispatch() {}, onClose() {} })));
    const result = await page.evaluate(() => {
      const dialog = document.querySelector('dialog');
      const rect = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; };
      const cancel = [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Cancel');
      return { box: rect(dialog), themeLabel: dialog.querySelector('select').getAttribute('aria-label'), paths:
        [...dialog.querySelectorAll('button[aria-disabled="true"]')].map(unavailable => {
          unavailable.focus(); const before = rect(cancel);
          // Pointer-down transfers focus before click. The explanation used to
          // collapse here, moving the click target within the centered modal.
          cancel.focus();
          const reason = document.getElementById(unavailable.getAttribute('aria-describedby'));
          return { before, after: rect(cancel), visible: getComputedStyle(reason).display !== 'none' };
        }) };
    });
    assert.equal(result.themeLabel, 'Analysis theme');
    const { box } = result;
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900);
    assert.equal(result.paths.length, 2);
    for (const path of result.paths) { assert.deepEqual(path.after, path.before); assert.equal(path.visible, true); }
  });
  for (const inApp of [true, false]) test(`${inApp ? 'app' : 'standalone'}: long names fit at 390px without losing accessible text`, async () => {
    await render(390, 'light', inApp);
    const result = await page.evaluate(() => {
      const title = document.querySelector('.analysis-title input');
      title.value = 'Long analysis name '.repeat(25);
      const label = document.querySelector('.q-trigger-label');
      label.textContent = 'Ask a question about ' + 'Long dataset name '.repeat(25);
      const q = label.closest('button');
      return { width: document.documentElement.scrollWidth, text: q.textContent, ellipsis: getComputedStyle(label).textOverflow,
        labelWidth: label.clientWidth, contentWidth: label.scrollWidth, titleWidth: title.getBoundingClientRect().width,
        brand: document.querySelector('.author-topbar .brand')?.getBoundingClientRect().right };
    });
    assert.equal(result.width, 390);
    assert.ok(result.titleWidth > 100);
    assert.ok(result.contentWidth > result.labelWidth);
    assert.equal(result.ellipsis, 'ellipsis');
    assert.match(result.text, /Ask a question about (Long dataset name ){25}$/);
    if (!inApp) assert.ok(result.brand < 390);
  });
  test('actions remain right aligned when Q is unavailable', async () => {
    await render(1440, 'dark');
    const result = await page.evaluate(() => {
      document.querySelector('.q-trigger').remove();
      return { right: document.querySelector('.chrome-switch').getBoundingClientRect().right,
        spacer: document.querySelector('.menu-spacer').getBoundingClientRect().width };
    });
    assert.equal(result.right, 1424);
    assert.ok(result.spacer > 0);
  });
  test('the Q close control stays above the sticky product and editor headers', async () => {
    for (const width of [1440, 390]) {
      await render(width, 'light');
      const result = await page.evaluate(() => {
        const product = document.createElement('header'); product.className = 'app-header product-header';
        product.textContent = 'Product navigation'; document.body.prepend(product);
        // Reproduce the panel's fixed top edge; assert actual hit testing, not
        // just a numeric z-index, against both real sticky header selectors.
        const panel = document.createElement('div'); panel.className = 'q-side-panel';
        panel.innerHTML = '<header class="q-panel-heading"><h2>ASK Q</h2><button>Close</button></header>';
        document.querySelector('.author-workspace').append(panel);
        const close = panel.querySelector('button');
        const hit = () => { const r = close.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === close; };
        const before = hit(); window.scrollTo(0, 200); return { before, after: hit() };
      });
      assert.deepEqual(result, { before: true, after: true });
    }
  });
});
