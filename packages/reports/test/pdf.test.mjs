import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layoutReport, renderPdf } from '../dist/index.js';
import { definition, rows } from './fixture.mjs';

test('real PDF has matching page objects, repeatable bytes and extractable escaped text', t => {
  const d = definition(); d.body.unshift({ kind: 'text', id: 'title', runs: [{ text: 'Synthetic (sample) \\ report', style: { bold: true } }] });
  const pages = layoutReport(d, rows(90)), bytes = renderPdf(d, pages), raw = Buffer.from(bytes).toString('latin1');
  assert.ok(bytes instanceof Uint8Array); assert.ok(raw.startsWith('%PDF-'));
  assert.ok(raw.includes("/CreationDate (D:19700101000000+00'00')"));
  assert.equal([...raw.matchAll(/\/Type \/Page\b/g)].length, pages.length);
  assert.deepEqual(renderPdf(d, pages), bytes);
  // Poppler is an independent local reader, not a shipped/bundled dependency.
  const dir = mkdtempSync(join(tmpdir(), 'opensight-report-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'synthetic.pdf'); writeFileSync(file, bytes);
  const extracted = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).split('\f').filter(p => p.trim());
  assert.equal(extracted.length, pages.length);
  for (const [i, p] of extracted.entries()) { assert.match(p, /Region\s+Amount/); assert.ok(p.includes(`Page ${i + 1} of ${pages.length}`)); assert.match(p, /Synthetic report/); }
  assert.match(extracted[0], /Synthetic \(sample\) \\ report/); assert.match(extracted.at(-1), /Synthetic 90/);
});
test('PDF empty table explicitly contains no data; invalid display lists fail closed', () => {
  const d = definition(), pages = layoutReport(d, { sales: [] });
  assert.match(Buffer.from(renderPdf(d, pages)).toString('latin1'), /no data/);
  for (const invalid of [[], [{ ...pages[0], totalPages: 2 }], [{ ...pages[0], items: [{ kind: 'image', x: 0, y: 0 }] }], [{ ...pages[0], width: 100 }]]) assert.throws(() => renderPdf(d, invalid), { code: 'REPORT_INVALID_LAYOUT' });
});
