import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { DARK_THEME } from '../build/test/themes.js';

const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const rows = Array.from({ length: 64 }, (_, i) => ({
  region: `Region_${String(Math.floor(i / 2)).padStart(2, '0')}`, category: `Category_${i % 8}`,
  order_id: i, revenue: 1000 + i, profit: 100 + i,
}));
const visual = (kind, formatting = {}, theme) => {
  const base = activeSheet(authorReducer(emptyDraft(), { type: 'add', kind })).visuals[0];
  return { ...buildAuthorVisual({ ...base, rows: ['region', 'order_id'], columns: kind === 'pivot' ? ['category'] : [],
    measures: ['revenue', 'profit'], totals: true, subtotals: kind === 'pivot',
    formatting: { names: { revenue: 'Revenue_per_region_in_currency', profit: 'Profit_per_region_in_currency' }, ...formatting } }), rows, theme };
};

describe('table and pivot freeze panes in Chromium', () => {
  let page;
  before(async () => {
    page = await chromiumPage();
  });
  after(async () => { await page?.close(); });

  async function render(input, surface) {
    const card = renderToStaticMarkup(createElement(VisualCard, { visual: input }));
    const wrapper = surface === 'dashboard'
      ? `<div class="dashboard-grid" style="width:420px">${card}</div>`
      : `<div class="author-card" style="width:420px;height:326px"><div class="author-card-toolbar">Author preview</div>${card}</div>`;
    await page.setContent(`<style>${css}</style>${wrapper}`);
  }

  for (const kind of ['table', 'pivot']) for (const surface of ['dashboard', 'author']) {
    for (const variant of ['default', 'formatted', 'dark', 'mobile']) test(`${surface} ${kind}: ${variant} headers and label cells stay frozen on both axes`, async () => {
      await page.setViewportSize({ width: variant === 'mobile' ? 650 : 1100, height: 800 });
      const formatting = variant === 'formatted' ? { headerBackground: '#ccddee', cellBackground: '#ffeedd' } : {};
      await render(visual(kind, formatting, variant === 'dark' ? DARK_THEME : undefined), surface);
      const result = await page.evaluate(() => {
        const scroll = document.querySelector('.table-scroll');
        const headers = [...scroll.querySelectorAll('thead th')];
        const labels = [...scroll.querySelectorAll('tbody tr > :first-child')];
        const movingCell = scroll.querySelector('tbody tr > :nth-child(2)');
        const rect = el => { const { x, y } = el.getBoundingClientRect(); return { x, y }; };
        const style = el => {
          const s = getComputedStyle(el);
          return { position: s.position, top: s.top, left: s.left, z: s.zIndex, background: s.backgroundColor };
        };
        const before = { corner: rect(headers[0]), header: rect(headers[1]), label: rect(labels[0]), cell: rect(movingCell) };
        scroll.scrollTop = 100; scroll.scrollLeft = 100;
        const after = { corner: rect(headers[0]), header: rect(headers[1]), label: rect(labels[0]), cell: rect(movingCell) };
        const bounds = scroll.getBoundingClientRect();
        const cornerOnTop = document.elementFromPoint(bounds.x + 5, bounds.y + 5) === headers[0];
        return { before, after, top: scroll.scrollTop, left: scroll.scrollLeft, cornerOnTop,
          headers: headers.map(style), labels: labels.map(style),
          rowKinds: labels.map(el => el.parentElement.className), cardScroll: scroll.closest('.visual-card').scrollTop,
          border: getComputedStyle(labels[0]).borderBottomWidth };
      });
      assert.equal(result.top, 100, 'rows must overflow inside the real card layout');
      assert.ok(result.left > 0, 'columns must overflow');
      assert.equal(result.cardScroll, 0);
      for (const header of result.headers) {
        assert.equal(header.position, 'sticky'); assert.equal(header.top, '0px');
        assert.equal(header.background, variant === 'formatted' ? 'rgb(204, 221, 238)' : variant === 'dark' ? 'rgb(20, 30, 44)' : 'rgb(243, 246, 247)');
      }
      for (const [i, label] of result.labels.entries()) {
        assert.equal(label.position, 'sticky'); assert.equal(label.left, '0px');
        assert.ok(Number(label.z) < Number(result.headers[1].z));
        const total = ['subtotal', 'total'].includes(result.rowKinds[i]);
        assert.equal(label.background, total ? variant === 'dark' ? 'rgb(20, 30, 44)' : 'rgb(243, 246, 247)' : variant === 'formatted' ? 'rgb(255, 238, 221)' : variant === 'dark' ? 'rgb(32, 46, 64)' : 'rgb(255, 255, 255)');
      }
      assert.ok(Number(result.headers[0].z) > Number(result.headers[1].z));
      assert.equal(result.headers[0].left, '0px');
      assert.deepEqual(result.after.corner, result.before.corner);
      assert.equal(result.after.header.y, result.before.header.y);
      assert.equal(result.after.label.x, result.before.label.x);
      assert.equal(result.after.cell.x, result.before.cell.x - result.left);
      assert.equal(result.after.cell.y, result.before.cell.y - result.top);
      assert.ok(result.cornerOnTop, 'corner must paint above both scrolling layers');
      assert.equal(result.border, '1px');
    });
  }

  test('conditional formatting remains opaque alongside the frozen column', async () => {
    const base = activeSheet(authorReducer(emptyDraft(), { type: 'add', kind: 'table' })).visuals[0];
    const input = { ...buildAuthorVisual({ ...base, rows: ['region'], measures: ['revenue', 'profit'],
      formatting: { rules: [{ fieldId: 'revenue', operator: 'gt', threshold: 0, color: '#112233', background: '#abcdef' }] } }), rows: [rows[0]] };
    await render(input, 'dashboard');
    const style = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('tbody tr td:nth-child(2)')); return [s.position, s.left, s.backgroundColor];
    });
    assert.deepEqual(style, ['static', 'auto', 'rgb(171, 205, 239)']);
  });

  test('hidden headers stay hidden and unrelated tables retain their existing layout', async () => {
    await render(visual('pivot', { headersVisible: false }), 'author');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('thead')).clip), 'rect(0px, 0px, 0px, 0px)');
    await page.setContent(`<style>${css}</style><table><thead><tr><th>Admin</th></tr></thead><tbody><tr><td>Row</td></tr></tbody></table>`);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('th, td')].map(el => getComputedStyle(el).position)), ['static', 'static']);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('table')).borderCollapse), 'collapse');
  });
});
