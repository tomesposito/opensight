import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import {
  decodePng,
  normalizeToReference,
  diffRegion,
  scoreRegions,
  buildReport,
  parseConfig,
  renderMarkdown,
  ParityError,
} from '../dist/index.js';

function solidPng(w, h, r, g, b) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  return png;
}

function writeTmp(png) {
  const dir = mkdtempSync(join(tmpdir(), 'parity-'));
  const path = join(dir, 'img.png');
  writeFileSync(path, PNG.sync.write(png));
  return path;
}

const FULL = { name: 'full', rect: { x: 0, y: 0, w: 1, h: 1 }, description: 'whole image' };

test('identical images diff to zero', async () => {
  const a = writeTmp(solidPng(40, 30, 10, 20, 30));
  const b = writeTmp(solidPng(40, 30, 10, 20, 30));
  const { scores, overallDiffFraction } = scoreRegions(
    await decodePng(a), await decodePng(b), [FULL], [], 16, 0.05,
  );
  assert.equal(scores[0].diffFraction, 0);
  assert.equal(scores[0].verdict, 'equivalent');
  assert.equal(overallDiffFraction, 0);
});

test('a changed quadrant yields the expected diff fraction', async () => {
  const ref = solidPng(40, 40, 0, 0, 0);
  const cap = solidPng(40, 40, 0, 0, 0);
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const o = (y * 40 + x) * 4;
      cap.data[o] = 200; cap.data[o + 1] = 200; cap.data[o + 2] = 200;
    }
  const a = writeTmp(ref);
  const b = writeTmp(cap);
  const { scores } = scoreRegions(
    await decodePng(a), await decodePng(b),
    [{ name: 'quad', rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, description: 'top-left quadrant' }],
    [], 16, 0.05,
  );
  assert.equal(scores[0].pixels, 400);
  assert.equal(scores[0].diffPixels, 400);
  assert.equal(scores[0].diffFraction, 1);
  assert.equal(scores[0].verdict, 'different');
});

test('a fully excluded region fails closed instead of scoring zero', async () => {
  const ref = solidPng(40, 40, 0, 0, 0);
  const cap = solidPng(40, 40, 255, 255, 255);
  const a = writeTmp(ref);
  const b = writeTmp(cap);
  const r = await decodePng(a);
  const c = await decodePng(b);
  assert.throws(
    () => scoreRegions(r, c, [FULL], [{ name: 'all', rect: { x: 0, y: 0, w: 1, h: 1 }, reason: 'everything excluded' }], 16, 0.05),
    (e) => e instanceof ParityError && e.code === 'PARITY_EMPTY_REGION',
  );
});

test('partial exclusion removes only the excluded pixels', async () => {
  const ref = solidPng(40, 40, 0, 0, 0);
  const cap = solidPng(40, 40, 255, 255, 255);
  const a = writeTmp(ref);
  const b = writeTmp(cap);
  const { scores } = scoreRegions(
    await decodePng(a), await decodePng(b), [FULL],
    [{ name: 'top-half', rect: { x: 0, y: 0, w: 1, h: 0.5 }, reason: 'test' }],
    16, 0.05,
  );
  assert.equal(scores[0].pixels, 800);
  assert.equal(scores[0].excludedPixels, 800);
  assert.equal(scores[0].diffFraction, 1);
});

test('tolerance absorbs small per-channel differences', async () => {
  const ref = solidPng(20, 20, 100, 100, 100);
  const cap = solidPng(20, 20, 110, 100, 100); // +10 red, within tolerance 16
  const a = writeTmp(ref);
  const b = writeTmp(cap);
  const loose = scoreRegions(await decodePng(a), await decodePng(b), [FULL], [], 16, 0.05);
  assert.equal(loose.scores[0].diffFraction, 0);
  const strict = scoreRegions(await decodePng(a), await decodePng(b), [FULL], [], 5, 0.05);
  assert.equal(strict.scores[0].diffFraction, 1);
});

test('normalization scales a different-sized same-color capture to zero diff', async () => {
  const ref = await decodePng(writeTmp(solidPng(60, 40, 7, 8, 9)));
  const cap = await decodePng(writeTmp(solidPng(120, 80, 7, 8, 9)));
  const norm = normalizeToReference(ref, cap);
  assert.equal(norm.aspectMismatch, false);
  assert.equal(norm.image.w, 60);
  assert.equal(norm.image.h, 40);
  const { overallDiffFraction } = scoreRegions(ref, norm.image, [FULL], [], 16, 0.05);
  assert.equal(overallDiffFraction, 0);
});

test('aspect mismatch is flagged, not silently scored', async () => {
  const ref = await decodePng(writeTmp(solidPng(100, 50, 7, 8, 9))); // 2.0
  const cap = await decodePng(writeTmp(solidPng(50, 50, 7, 8, 9)));   // 1.0
  const norm = normalizeToReference(ref, cap);
  assert.equal(norm.aspectMismatch, true);
});

test('broken inputs fail closed with named errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-'));
  const missing = join(dir, 'nope.png');
  await assert.rejects(() => decodePng(missing), (e) => e instanceof ParityError && e.code === 'PARITY_READ_FAILED');
  const notPng = join(dir, 'x.jpg');
  writeFileSync(notPng, Buffer.from([0xff, 0xd8]));
  await assert.rejects(() => decodePng(notPng), (e) => e instanceof ParityError && e.code === 'PARITY_UNSUPPORTED_FORMAT');
  const garbage = join(dir, 'g.png');
  writeFileSync(garbage, Buffer.from('not a png'));
  await assert.rejects(() => decodePng(garbage), (e) => e instanceof ParityError && e.code === 'PARITY_DECODE_FAILED');
  assert.throws(() => parseConfig('not json'), (e) => e instanceof ParityError && e.code === 'PARITY_CONFIG_INVALID');
  assert.throws(() => parseConfig('{"pairings":[]}'), (e) => e instanceof ParityError && e.code === 'PARITY_CONFIG_INVALID');
});

test('empty region fails closed', async () => {
  const img = await decodePng(writeTmp(solidPng(20, 20, 0, 0, 0)));
  assert.throws(
    () => diffRegion(img, img, { name: 'void', rect: { x: 2, y: 2, w: 0.1, h: 0.1 }, description: 'off-canvas' }, [], 16),
    (e) => e instanceof ParityError && e.code === 'PARITY_EMPTY_REGION',
  );
});

test('report ranks top gaps and renders markdown', async () => {
  const a = writeTmp(solidPng(40, 40, 0, 0, 0));
  const b = writeTmp(solidPng(40, 40, 255, 0, 0));
  const report = await buildReport([{
    id: 't1', title: 'T', reference: a, capture: b,
    viewport: '40x40', theme: 'light', fixture: 'synthetic',
    regions: [
      { name: 'left', rect: { x: 0, y: 0, w: 0.5, h: 1 }, description: 'left half' },
      { name: 'right', rect: { x: 0.5, y: 0, w: 0.5, h: 1 }, description: 'right half' },
    ],
    exclusions: [{ name: 'quarter', rect: { x: 0.5, y: 0, w: 0.25, h: 1 }, reason: 'test' }],
    structural: [{ item: 'thing', present: true, note: 'ok' }],
  }]);
  assert.equal(report.pairings.length, 1);
  assert.equal(report.topGaps.length, 2);
  assert.ok(report.topGaps[0].diffFraction >= report.topGaps[1].diffFraction);
  const md = renderMarkdown(report);
  assert.ok(md.includes('left') && md.includes('right'));
  assert.ok(md.includes('✅ thing'));
  assert.ok(md.includes(report.interpretation.slice(0, 40)));
});

test('CLI runs end to end and writes report files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-cli-'));
  const ref = join(dir, 'ref.png');
  const cap = join(dir, 'cap.png');
  writeFileSync(ref, PNG.sync.write(solidPng(32, 32, 1, 2, 3)));
  writeFileSync(cap, PNG.sync.write(solidPng(32, 32, 1, 2, 3)));
  const config = join(dir, 'pairings.json');
  writeFileSync(config, JSON.stringify({
    pairings: [{
      id: 'cli', title: 'CLI', reference: ref, capture: cap,
      viewport: '32x32', theme: 'light', fixture: 'synthetic',
      regions: [FULL], exclusions: [], structural: [],
    }],
  }));
  const out = join(dir, 'out');
  const stdout = execFileSync('node', [new URL('../dist/run.js', import.meta.url).pathname, '--config', config, '--out', out], { encoding: 'utf8' });
  assert.ok(stdout.includes('cli:'));
  assert.ok(existsSync(join(out, 'report.json')));
  assert.ok(existsSync(join(out, 'report.md')));
  const parsed = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.equal(parsed.pairings[0].overallDiffFraction, 0);
});
