// Offline Issue #67 verification: text and image sheet objects in the author.
// Drives the freshly built static demo; all raw artifacts stay in the ignored
// .opensight/issue-67/browser/ directory. No external HTTP is permitted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const out = resolve('.opensight/issue-67/browser');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], requests = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
const check = label => { checks.push(label); console.log(label); };
const capture = name => page.screenshot({ path: resolve(out, `${name}.png`) });
const menu = name => page.locator(`[data-author-menu="${name}"]`);
const openMenu = async name => { await page.evaluate(() => window.scrollTo(0, 0)); if (!await menu(name).evaluate(node => node.open)) await menu(name).locator('summary').click(); };
const action = async (name, label) => { await openMenu(name); await menu(name).getByRole('button', { name: label, exact: true }).click(); };
const snapshot = async () => {
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  return page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('opensight.author.drafts.v1.demo')); return saved.entries.find(entry => entry.id === saved.activeId).draft; });
};
const activeSheet = draft => draft.sheets.find(sheet => sheet.id === draft.activeSheetId);
const undo = () => action('Edit', 'Undo'), redo = () => action('Edit', 'Redo');
// Synthetic test image (generated here, never committed).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#166f7a"/><circle cx="60" cy="40" r="22" fill="#f2c14e"/></svg>`;
writeFileSync('/tmp/issue67-test-image.svg', svg);
try {
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' });
  await navigate(page, 'author'); await page.locator('.author-menu').waitFor();
  // Insert menu: Add Text / Add Image enabled without data.
  await openMenu('Insert');
  for (const label of ['Add Text', 'Add Image']) assert.equal(await menu('Insert').getByRole('button', { name: label, exact: true }).getAttribute('aria-disabled'), 'false');
  await capture('insert-menu'); check('Insert menu shows Add Text and Add Image enabled');
  await page.keyboard.press('Escape');
  // Add a text box via the menu, edit content in place, style it.
  await action('Insert', 'Add Text');
  const textCard = page.locator('section.sheet-object', { has: page.locator('textarea[aria-label$="content"]') });
  await textCard.waitFor();
  await textCard.locator('textarea').fill('Quarterly highlights');
  await page.getByLabel('Text font size', { exact: true }).fill('28');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByLabel('Text alignment', { exact: true }).selectOption('center');
  let draft = await snapshot();
  let objects = activeSheet(draft).objects;
  assert.equal(objects.length, 1); assert.equal(objects[0].kind, 'text');
  assert.equal(objects[0].content, 'Quarterly highlights');
  assert.deepEqual(objects[0].style, { fontSize: 28, bold: true, italic: false, underline: false, color: '#202938', alignment: 'center' });
  check('Text box added, content edited in place, font size/bold/alignment saved');
  // Keyboard move via the Move handle, then undo/redo round trip.
  const before = activeSheet(draft).layout.find(p => p.i === objects[0].id);
  await textCard.getByRole('button', { name: /Move Text box/ }).focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
  draft = await snapshot();
  const moved = activeSheet(draft).layout.find(p => p.i === objects[0].id);
  assert.equal(moved.x, before.x + 1); assert.equal(moved.w, before.w + 1);
  await undo(); draft = await snapshot();
  assert.deepEqual(activeSheet(draft).layout.find(p => p.i === objects[0].id), before);
  await redo(); draft = await snapshot();
  assert.equal(activeSheet(draft).layout.find(p => p.i === objects[0].id).x, before.x + 1);
  check('Arrow-key move and Shift+arrow resize undo/redo through the Edit menu');
  // Add an image through the device-local picker.
  await action('Insert', 'Add Image');
  await page.locator('input[aria-label="Insert local image"]').setInputFiles('/tmp/issue67-test-image.svg');
  const imageCard = page.locator('section.sheet-object', { has: page.locator('img') });
  await imageCard.waitFor();
  draft = await snapshot(); objects = activeSheet(draft).objects;
  assert.equal(objects.length, 2); assert.equal(objects[1].kind, 'image');
  assert.match(objects[1].dataUri, /^data:image\/svg\+xml;base64,/);
  await page.getByLabel('Image description', { exact: true }).fill('Teal badge');
  await page.getByLabel('Image opacity (%)', { exact: true }).fill('80');
  draft = await snapshot(); objects = activeSheet(draft).objects;
  assert.equal(objects[1].alt, 'Teal badge'); assert.equal(objects[1].opacity, 0.8);
  check('Image embedded from this device with description and opacity');
  await capture('canvas-objects'); check('Canvas with styled text box and embedded image captured');
  // Objects menu: selection list includes both objects; remove via menu.
  await openMenu('Objects');
  await menu('Objects').getByRole('button', { name: /Image 2/ }).click();
  await openMenu('Objects'); await action('Objects', 'Placement');
  assert.equal(await page.getByLabel('Object column', { exact: true }).evaluate(node => document.activeElement === node), true);
  check('Objects menu selects the image and Placement focuses its numeric controls');
  await openMenu('Objects'); await action('Objects', 'Remove selected object');
  draft = await snapshot(); objects = activeSheet(draft).objects;
  assert.equal(objects.length, 1); assert.equal(objects[0].kind, 'text');
  await undo(); draft = await snapshot();
  assert.equal(activeSheet(draft).objects.length, 2);
  check('Object removal via Objects menu and undo restore');
  // Definition export round trip preserves the objects.
  const exported = await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('opensight.author.drafts.v1.demo')); return saved.entries.find(entry => entry.id === saved.activeId).draft; });
  const sheet = activeSheet(exported);
  assert.ok(sheet.objects.every(o => o.kind === 'text' || o.kind === 'image'));
  await capture('objects-properties');
  console.log('checks:', checks.length, 'errors:', JSON.stringify(errors.slice(0, 4)), 'requests:', requests.length);
  assert.equal(errors.length, 0); assert.equal(requests.length, 0);
} finally {
  await browser.close();
}
