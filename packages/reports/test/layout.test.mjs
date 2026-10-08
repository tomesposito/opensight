import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutReport, PT_MM } from '../dist/index.js';
import { definition, rows } from './fixture.mjs';
const text = (page, role) => page.items.filter(i => i.kind === 'text' && (!role || i.role === role)).map(i => i.text).join('');

// Deliberately choose geometry that fits exactly one header + 3 single-line rows.
function exact() {
  const d = definition(); d.header.runs = []; d.footer.runs = [];
  d.pageSetup.margins.bottom = 140; d.pageSetup.margins.top = 297 - 140 - 4 * (10 * PT_MM * 1.2 + 4);
  return d;
}
for (const [n, count] of [[1, 1], [3, 1], [4, 2], [6, 2], [7, 3], [30, 10]]) test(`${n} synthetic rows flow to exactly ${count} pages with repeated headers`, () => {
  const pages = layoutReport(exact(), rows(n)); assert.equal(pages.length, count);
  for (const p of pages) assert.equal(text(p, 'table-header'), 'RegionAmount');
  assert.equal(pages.flatMap(p => p.items.filter(i => i.role === 'table-row' && i.kind === 'rect')).length, n * 2);
});
test('header/footer placeholders resolve after final pagination and inputs are unchanged', () => {
  const d = definition(), r = rows(90), before = structuredClone({ d, r }), pages = layoutReport(d, r);
  assert.equal(pages.length, 4);
  for (const p of pages) {
    assert.equal(text(p, 'header'), d.title);
    assert.equal(text(p, 'footer'), `Page ${p.number} of 4 | 2026-10-08`);
  }
  assert.deepEqual({ d, r }, before); assert.deepEqual(layoutReport(d, r), pages);
});
test('row overflow is a named error, including a summary that cannot fit', () => {
  const d = exact();
  assert.throws(() => layoutReport(d, { sales: [{ region: 'x\n'.repeat(50), amount: 1 }] }), { code: 'REPORT_ROW_OVERFLOW' });
  d.body[0].summary = ['x\n'.repeat(50), 1];
  assert.throws(() => layoutReport(d, rows(1)), { code: 'REPORT_ROW_OVERFLOW' });
});
test('empty tables explicitly render no data; missing rows are rejected', () => {
  const pages = layoutReport(definition(), { sales: [] });
  assert.equal(pages.length, 1); assert.equal(text(pages[0], 'no-data'), 'no data');
  assert.throws(() => layoutReport(definition(), {}), { code: 'REPORT_INVALID_ROWS' });
});
test('text flows line by line and summary moves with a repeated header', () => {
  const d = exact(); d.body = [{ kind: 'text', id: 'intro', runs: [{ text: Array.from({ length: 20 }, (_, i) => `Line ${i}`).join('\n') }] }];
  const pages = layoutReport(d, {}); assert.equal(pages.length, 3);
  assert.equal(pages.map(p => text(p, 'text')).join(''), Array.from({ length: 20 }, (_, i) => `Line ${i}`).join(''));
  const table = exact(); table.body[0].summary = ['Total', 6];
  const result = layoutReport(table, rows(3)); assert.equal(result.length, 2);
  assert.equal(text(result[1], 'table-header'), 'RegionAmount'); assert.equal(text(result[1], 'table-summary'), 'Total6');
});
test('mixed-size text runs retain style and flow long unbroken strings', () => {
  const d = definition(); d.body = [{ kind: 'text', id: 'text', headingLevel: 1, runs: [{ text: 'Heading' }, { text: 'x'.repeat(4000), style: { fontSize: 12, italic: true, color: '#123456' } }] }];
  const pages = layoutReport(d, {}); assert.ok(pages.length > 1);
  assert.equal(pages.flatMap(p => p.items).find(i => i.text === 'Heading').style.bold, true);
  assert.equal(pages.map(p => text(p, 'text')).join(''), 'Heading' + 'x'.repeat(4000));
});
test('unsupported glyphs and repeating bands that consume the page fail closed', () => {
  const d = definition(); d.header.runs = [{ text: 'Unsupported: 😺' }];
  assert.throws(() => layoutReport(d, rows(1)), { code: 'REPORT_UNSUPPORTED_TEXT' });
  d.header.runs = [{ text: 'header\n'.repeat(100) }];
  assert.throws(() => layoutReport(d, rows(1)), { code: 'REPORT_PAGE_OVERFLOW' });
});
