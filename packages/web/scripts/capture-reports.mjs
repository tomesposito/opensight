// Run after build:demo. Local Chromium + local tools; no network requests permitted.
import { chromium } from '/home/hatch/workspace/tools/screenshots/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true });
const page = await context.newPage(), errors = [], external = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (/^https?:/.test(r.url())) external.push(r.url()); });
await page.route(/^https?:/, r => r.abort());
try {
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href + '#/reports');
  await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor();
  assert.equal(await page.getByRole('img', { name: 'Report page 1 of 3' }).count(), 1);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Report definition saved' }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('../../../docs/images/reports.png', import.meta.url)) });
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByRole('img', { name: 'Report page 2 of 3' }).waitFor();
  await page.screenshot({ path: '/tmp/opensight-reports-page-2.png' });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const download = await pending; await download.saveAs('/tmp/opensight-report-browser.pdf');
  assert.ok(readFileSync('/tmp/opensight-report-browser.pdf').subarray(0, 4).equals(Buffer.from('%PDF')));
  await page.reload();
  await page.getByRole('button', { name: 'Sales activity - sample report', exact: true }).click();
  await page.getByRole('img', { name: 'Report page 1 of 3' }).waitFor();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  assert.ok(await page.getByRole('button', { name: 'Next page', exact: true }).isDisabled());
  await page.getByRole('img', { name: 'Report page 3 of 3' }).waitFor();
  await page.screenshot({ path: '/tmp/opensight-reports-page-3.png' });
  // The new Reports navigation also changes the README's home/dashboard capture.
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: fileURLToPath(new URL('../../../docs/images/sample-dashboard.png', import.meta.url)) });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ pages: 3, navigation: 'passed', savedReload: 'passed', exportedPdf: '/tmp/opensight-report-browser.pdf', pageErrors: errors.length, externalRequests: external.length }));
} finally { await browser.close(); }
