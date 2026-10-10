// Offline File-menu verification and README storyboard. Capture/ffmpeg workflow
// adapted from ~/workspace/tools/screenshots/readme-gif.mjs (no external HTTP).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const out = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-65/browser');
mkdirSync(resolve(out, 'gif/frames'), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], requests = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
const menu = page.locator('[data-author-menu="File"]');
let frame = 0;
const hold = async (count = 8) => { for (let n = 0; n < count; n++) await page.screenshot({ path: resolve(out, `gif/frames/f${String(frame++).padStart(3, '0')}.png`) }); };
const capture = name => page.screenshot({ path: resolve(out, `${name}.png`) });
const check = label => { checks.push(label); console.log(label); };
const openFile = async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  if (!await menu.evaluate(node => node.open)) await menu.locator('summary').click();
};
const fileAction = async label => { await openFile(); await menu.getByRole('button', { name: label, exact: true }).click(); };
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('opensight.author.drafts.v1.demo')));
try {
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' });
  await hold();
  await page.getByRole('button', { name: /^Ask a question about / }).click();
  await page.locator('#o-question').fill('revenue by region'); await page.locator('#o-question').press('Enter');
  await page.locator('.o-result .chart svg').waitFor(); await hold();
  await page.getByRole('button', { name: 'Close Ask Q' }).click();
  await navigate(page, 'author');
  await page.locator('.author-menu').waitFor();
  await page.getByLabel('Analysis title', { exact: true }).fill('Revenue analysis');
  await page.getByRole('button', { name: 'Assign region', exact: true }).click();
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture('author'); await hold();
  assert.equal((await saved()).entries.filter(entry => entry.favorite).length, 0); check('Favorites start empty');
  await openFile(); await capture('file-menu'); await hold();
  await fileAction('Add to Favorites');
  const original = await saved(), originalId = original.activeId;
  assert.equal(original.entries.find(e => e.id === originalId).favorite, true); check('File favorite persists');
  await page.reload(); await openFile();
  assert.equal(await menu.getByRole('button', { name: 'Remove from Favorites', exact: true }).count(), 1); check('Favorite survives reload');
  await page.keyboard.press('Escape');
  await fileAction('Save as Analysis');
  const dialog = page.getByRole('dialog', { name: 'Save as Analysis', exact: true });
  await dialog.waitFor(); await capture('save-copy'); await hold();
  await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0);
  assert.equal(await menu.locator('summary').evaluate(node => node === document.activeElement), true); check('Copy Escape restores File focus');
  assert.equal((await saved()).entries.length, original.entries.length); check('Copy cancellation creates no entry');
  await page.getByLabel('Analysis title', { exact: true }).fill('Current unsaved edits');
  await fileAction('Save as Analysis');
  await dialog.getByLabel('Analysis name', { exact: true }).fill('Revenue analysis (copy)');
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click();
  const copy = await saved(), copyId = copy.activeId;
  assert.notEqual(copyId, originalId);
  assert.equal(copy.entries.find(e => e.id === copyId).draft.title, 'Revenue analysis (copy)');
  assert.deepEqual(copy.entries.find(e => e.id === originalId), original.entries.find(e => e.id === originalId)); check('Copy has its own name and identity and preserves original');
  await page.reload(); assert.equal(await page.getByLabel('Analysis title', { exact: true }).inputValue(), 'Revenue analysis (copy)'); check('Reload opens the copy');
  await openFile(); const share = menu.getByRole('button', { name: 'Share', exact: true });
  await share.focus();
  const reason = await share.getAttribute('aria-describedby');
  assert.equal(await share.getAttribute('aria-disabled'), 'true');
  assert.match(await page.locator(`[id="${reason}"]`).innerText(), /needs hosted API.*static demo/);
  assert.equal(await page.locator(`[id="${reason}"]`).isVisible(), true);
  await page.keyboard.press('Enter'); assert.equal(await menu.evaluate(node => node.open), true);
  await capture('share-reason'); await hold(); check('Share focus and keyboard activation explain unavailable hosted sharing');
  await share.hover(); assert.equal(await page.locator(`[id="${reason}"]`).isVisible(), true); check('Share hover explanation');
  await page.getByLabel('Analysis title', { exact: true }).click(); assert.equal(await menu.evaluate(node => node.open), false); check('Outside click closes File');
  await page.evaluate(() => {
    window.printEvents = []; window.printSnapshots = []; window.nativePrintCalls = 0;
    const nativePrint = window.print.bind(window);
    window.print = () => { window.nativePrintCalls++; nativePrint(); };
    window.addEventListener('beforeprint', () => { window.printEvents.push('before'); const root = document.querySelector('.analysis-print-root'); if (root) window.printSnapshots.push(root.outerHTML); });
    window.addEventListener('afterprint', () => window.printEvents.push('after'));
  });
  await fileAction('Print');
  assert.ok((await page.evaluate(() => window.printEvents)).includes('before'));
  // Headless Chromium opens native printing without a preview UI; finish that
  // print through the same browser renderer's PDF destination.
  await page.pdf({ path: resolve(out, 'analysis-print.pdf'), printBackground: true, preferCSSPageSize: true });
  assert.ok((await page.evaluate(() => window.printEvents)).includes('after'));
  assert.equal(await page.locator('.analysis-print-root').count(), 0); check('Print invokes native browser printing and cleans up');
  const printedEvents = await page.evaluate(() => window.printEvents.length);
  await fileAction('Export to PDF');
  const pdfDialog = page.getByRole('dialog', { name: 'Export to PDF', exact: true });
  await pdfDialog.waitFor(); await capture('export-pdf'); await hold();
  await pdfDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.evaluate(() => window.printEvents.length), printedEvents); check('PDF cancel does not print');
  await fileAction('Export to PDF');
  await pdfDialog.getByRole('button', { name: 'Continue to Save as PDF', exact: true }).click();
  assert.equal(await pdfDialog.count(), 0); assert.equal(await page.evaluate(() => window.nativePrintCalls), 2); check('PDF continuation invokes native print');
  await page.emulateMedia({ media: 'print' }); await capture('print-preview');
  await page.pdf({ path: resolve(out, 'analysis-snapshot.pdf'), printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  assert.equal(await page.locator('.analysis-print-root').count(), 0); check('Browser generates snapshot PDF and print preview');
  await page.locator('.analysis-search').click();
  const search = page.getByRole('combobox', { name: 'Search analysis actions', exact: true });
  await search.fill('File:'); await capture('command-palette'); await hold();
  assert.match(await page.getByRole('dialog', { name: 'Command palette', exact: true }).innerText(), /Save as Analysis/);
  assert.doesNotMatch(await page.getByRole('dialog', { name: 'Command palette', exact: true }).innerText(), /File: Share/); check('Palette exposes enabled File actions and omits Share');
  await search.fill('File: Add to Favorites'); await page.keyboard.press('Enter');
  assert.equal((await saved()).entries.find(e => e.id === copyId).favorite, true); check('Palette Favorite executes real callback');
  await fileAction('Remove from Favorites'); assert.equal((await saved()).entries.find(e => e.id === copyId).favorite, undefined); check('Remove Favorite persists');
  await navigate(page, 'analyses');
  await page.getByLabel('Favorites only', { exact: true }).check();
  assert.equal(await page.getByRole('button', { name: 'Open Revenue analysis', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Open Revenue analysis (copy)', exact: true }).count(), 0);
  await capture('analyses'); await capture('local-drafts'); await hold(); check('My analyses Favorites filter shows only marked analyses');
  await page.getByRole('button', { name: 'Open Revenue analysis', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByLabel('NEW LOOK', { exact: true }).selectOption('dark');
    for (const width of [1440, 760, 390]) {
      await page.setViewportSize({ width, height: 900 }); await openFile(); await share.focus();
      await capture(`file-${width}-${theme}`);
      const bounds = await menu.locator('.menu-popover').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await page.keyboard.press('Escape');
      await fileAction('Save as Analysis'); const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      await page.keyboard.press('Escape');
      await fileAction('Export to PDF'); await pdfDialog.waitFor(); const pdfBox = await pdfDialog.boundingBox(); assert.ok(pdfBox.x >= 0 && pdfBox.x + pdfBox.width <= width + 1);
      await page.keyboard.press('Escape'); check(`${width}px ${theme}: File and copy/PDF dialogs fit; Escape closes`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigate(page, 'data-prep'); await hold();
  await navigate(page, 'data-sources'); await hold();
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ checks, errors, externalHTTPRequests: requests, frames: frame }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors: errors.length, externalHTTPRequests: requests.length, frames: frame }));
} catch (error) { await capture('failure'); throw error; }
finally { await browser.close(); }
// ffmpeg -y -framerate 10 -i .opensight/issue-65/browser/gif/frames/f%03d.png -vf "scale=960:-1:flags=lanczos,palettegen" .opensight/issue-65/browser/gif/palette.png
// ffmpeg -y -framerate 10 -i .opensight/issue-65/browser/gif/frames/f%03d.png -i .opensight/issue-65/browser/gif/palette.png -lavfi "scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse" .opensight/issue-65/browser/gif/opensight-tour.gif
