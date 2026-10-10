// Offline Edit-menu verification and README storyboard. Capture/ffmpeg workflow
// adapted from ~/workspace/tools/screenshots/readme-gif.mjs. All raw artifacts
// stay in the ignored issue directory; no external HTTP is permitted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
const out = resolve('.opensight/issue-66/browser');
mkdirSync(resolve(out, 'gif/frames'), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], requests = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
let frame = 0;
const hold = async (count = 8) => { for (let n = 0; n < count; n++) await page.screenshot({ path: resolve(out, `gif/frames/f${String(frame++).padStart(3, '0')}.png`) }); };
const capture = name => page.screenshot({ path: resolve(out, `${name}.png`) });
const check = label => { checks.push(label); console.log(label); };
const menu = name => page.locator(`[data-author-menu="${name}"]`);
const openMenu = async name => { await page.evaluate(() => window.scrollTo(0, 0)); if (!await menu(name).evaluate(node => node.open)) await menu(name).locator('summary').click(); };
const action = async (name, label) => { await openMenu(name); await menu(name).getByRole('button', { name: label, exact: true }).click(); };
const snapshot = async () => {
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  return page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('opensight.author.drafts.v1.demo')); return saved.entries.find(entry => entry.id === saved.activeId).draft; });
};
const undo = () => action('Edit', 'Undo'), redo = () => action('Edit', 'Redo');
const settings = page.getByRole('dialog', { name: 'Analysis Settings', exact: true });
const title = page.getByLabel('Analysis title', { exact: true });
const visual = draft => draft.sheets.find(sheet => sheet.id === draft.activeSheetId).visuals[0];
const explain = async (button, pattern) => {
  await button.focus(); assert.equal(await button.getAttribute('aria-disabled'), 'true');
  assert.equal(await button.getAttribute('disabled'), null);
  const reason = page.locator(`[id="${await button.getAttribute('aria-describedby')}"]`);
  assert.match(await reason.innerText(), pattern); assert.equal(await reason.isVisible(), true);
  await page.keyboard.press('Enter'); await button.hover(); assert.equal(await reason.isVisible(), true);
};
try {
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' }); await hold();
  await page.getByRole('button', { name: /^Ask a question about / }).click();
  await page.locator('#o-question').fill('revenue by region'); await page.locator('#o-question').press('Enter');
  await page.locator('.o-result .chart svg').waitFor(); await hold();
  await page.getByRole('button', { name: 'Close Ask Q' }).click();
  await navigate(page, 'author'); await page.locator('.author-menu').waitFor();
  const initial = await snapshot();
  await openMenu('Edit');
  await explain(menu('Edit').getByRole('button', { name: 'Undo', exact: true }), /Nothing to undo/);
  await explain(menu('Edit').getByRole('button', { name: 'Redo', exact: true }), /Nothing to redo/);
  await capture('empty-history'); check('Empty Undo/Redo are keyboard reachable, inert and explain availability on focus/hover');
  await page.keyboard.press('Escape'); assert.equal(await menu('Edit').locator('summary').evaluate(node => node === document.activeElement), true);
  await openMenu('Edit'); await title.click(); assert.equal(await menu('Edit').evaluate(node => node.open), false); check('Edit Escape restores focus and outside click closes');
  await page.getByRole('button', { name: 'Assign region', exact: true }).click();
  const assigned = await snapshot(); assert.equal(assigned.sheets[0].visuals.length, 1);
  await undo(); assert.deepEqual(await snapshot(), initial); assert.equal(await page.locator('.author-card').count(), 0);
  await page.keyboard.press('Control+Shift+Z'); assert.deepEqual(await snapshot(), assigned); check('First field assignment and automatic visual creation undo/redo atomically');
  const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData('application/x-opensight-field', 'revenue'); return data; });
  await page.locator('.field-wells fieldset').filter({ has: page.locator('legend', { hasText: /^VALUE$/ }) }).dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  const dropped = await snapshot(); assert.deepEqual(visual(dropped).measures, ['revenue']);
  await page.locator('.author-card .chart svg').waitFor();
  await undo(); assert.deepEqual(await snapshot(), assigned);
  await redo(); assert.deepEqual(await snapshot(), dropped); check('A real field-well drop changes fields/rendering and reverses exactly');
  await page.getByRole('button', { name: 'Remove revenue from Value', exact: true }).click();
  assert.deepEqual(visual(await snapshot()).measures, []);
  await page.keyboard.press('Meta+z'); assert.deepEqual(await snapshot(), dropped);
  await page.keyboard.press('Meta+Shift+z'); assert.deepEqual(visual(await snapshot()).measures, []);
  await page.keyboard.press('Control+z'); assert.deepEqual(await snapshot(), dropped); check('Field removal and both Cmd/Ctrl history shortcuts restore the actual assignment');
  await action('Objects', 'Title');
  await page.getByLabel('Title', { exact: true }).fill('Revenue by region');
  const titled = await snapshot(); assert.equal(visual(titled).title, 'Revenue by region');
  await page.getByLabel('Title', { exact: true }).focus(); await page.keyboard.press('Control+z'); assert.deepEqual(await snapshot(), dropped);
  await page.keyboard.press('Control+y'); assert.deepEqual(await snapshot(), titled); check('Property text input participates in global history; Ctrl+Y restores its value');
  await action('Insert', 'Add Visual'); const added = await snapshot(); assert.equal(added.sheets[0].visuals.length, 2);
  await action('Objects', 'Remove selected visual'); const removed = await snapshot(); assert.equal(removed.sheets[0].visuals.length, 1);
  await undo(); assert.deepEqual(await snapshot(), added); assert.equal(await page.locator('.author-card').count(), 2);
  await undo(); assert.deepEqual(await snapshot(), titled);
  await redo(); assert.deepEqual(await snapshot(), added);
  await redo(); assert.deepEqual(await snapshot(), removed); check('Visual add/remove undo×2 and redo×2 restore exact layouts, IDs, selection and cards');
  await undo(); await undo();
  await action('Objects', 'Title'); await page.getByLabel('Title', { exact: true }).fill('New branch');
  const branched = await snapshot();
  await openMenu('Edit'); await explain(menu('Edit').getByRole('button', { name: 'Redo', exact: true }), /new edit clears redo/);
  await page.keyboard.press('Escape'); await page.keyboard.press('Control+y'); assert.deepEqual(await snapshot(), branched); check('New property edit after undo clears redo and disabled activation is inert');
  await undo(); assert.deepEqual(await snapshot(), titled);
  await action('Edit', 'Analysis Settings');
  await settings.getByLabel('Analysis name', { exact: true }).fill('Discarded name');
  await settings.getByRole('textbox', { name: 'Description', exact: true }).fill('Discarded notes');
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await menu('Edit').locator('summary').evaluate(node => node === document.activeElement), true);
  assert.deepEqual(await snapshot(), titled); check('Settings Cancel discards staged edits and restores Edit focus');
  await action('Edit', 'Analysis Settings'); await page.keyboard.press('Escape'); assert.equal(await settings.count(), 0);
  assert.equal(await menu('Edit').locator('summary').evaluate(node => node === document.activeElement), true); check('Settings Escape closes and restores Edit focus');
  await action('Edit', 'Analysis Settings');
  await settings.getByLabel('Analysis name', { exact: true }).fill(''); assert.equal(await settings.getByRole('button', { name: 'Apply settings', exact: true }).isDisabled(), true);
  await settings.getByLabel('Analysis name', { exact: true }).fill('Revenue analysis');
  await settings.getByRole('textbox', { name: 'Description', exact: true }).fill('Synthetic sales by region. Prepared for a monthly review.');
  await settings.getByLabel('Analysis theme', { exact: true }).selectOption('dark');
  await capture('analysis-settings'); await hold();
  await settings.getByRole('button', { name: 'Apply settings', exact: true }).click();
  const configured = await snapshot(); assert.equal(configured.title, 'Revenue analysis'); assert.match(configured.description, /Synthetic sales/);
  assert.equal(await page.locator('.author-canvas').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(20, 30, 44)');
  await undo(); assert.deepEqual(await snapshot(), titled);
  await redo(); assert.deepEqual(await snapshot(), configured); check('Settings validate, apply actual theme/metadata and undo/redo as a single command');
  await action('Edit', 'Analysis Settings');
  await explain(settings.getByRole('button', { name: 'Locale and date-format defaults', exact: true }), /not supported yet.*UTC/);
  await capture('settings-locale-reason');
  await explain(settings.getByRole('button', { name: 'Sharing and permissions', exact: true }), /hosted analysis.*hosted API/);
  await capture('settings-sharing-reason'); assert.equal(await settings.count(), 1);
  await page.keyboard.press('Control+z'); assert.equal(await settings.count(), 1);
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.deepEqual(await snapshot(), configured); check('Disabled settings explain limits; activation and modal shortcuts cannot change the background analysis');
  await page.locator('.analysis-search').click();
  const search = page.getByRole('combobox', { name: 'Search analysis actions', exact: true });
  await search.fill('Edit:'); await capture('command-palette'); await hold();
  assert.match(await page.getByRole('dialog', { name: 'Command palette', exact: true }).innerText(), /Edit: Undo/);
  await search.fill('Edit: Undo'); await page.keyboard.press('Enter'); assert.deepEqual(await snapshot(), titled);
  await page.locator('.analysis-search').click(); await search.fill('Edit: Redo'); await page.keyboard.press('Enter'); assert.deepEqual(await snapshot(), configured);
  await page.locator('.analysis-search').click(); await search.fill('Edit: Analysis Settings'); await page.keyboard.press('Enter'); await settings.waitFor();
  assert.equal(await settings.getByLabel('Analysis name', { exact: true }).inputValue(), configured.title);
  await page.keyboard.press('Escape'); check('Palette Undo/Redo and Analysis Settings execute the same live actions');
  await action('File', 'Exports');
  const downloaded = page.waitForEvent('download'); await menu('File').getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloaded; await download.saveAs(resolve(out, 'analysis-definition.json'));
  const { readFileSync } = await import('node:fs'); const exported = JSON.parse(readFileSync(resolve(out, 'analysis-definition.json'), 'utf8'));
  assert.equal(exported.name, configured.title); assert.equal(exported.definition.opensightDescription, configured.description); assert.deepEqual(exported.definition.opensightTheme, configured.theme); check('Definition download contains settings without history');
  await page.reload(); assert.equal(await title.inputValue(), configured.title);
  await openMenu('Edit'); await explain(menu('Edit').getByRole('button', { name: 'Undo', exact: true }), /Nothing to undo/);
  await action('Edit', 'Analysis Settings'); assert.equal(await settings.getByRole('textbox', { name: 'Description', exact: true }).inputValue(), configured.description); await page.keyboard.press('Escape'); check('Reload preserves settings and clears session history');
  await action('Edit', 'Analysis Settings'); await settings.getByLabel('Analysis theme', { exact: true }).selectOption('light'); await settings.getByRole('button', { name: 'Apply settings', exact: true }).click();
  // Close the Properties rail for the README canvas view at 1280px.
  await page.locator('.properties-panel').evaluate(node => { node.open = false; });
  await page.evaluate(() => window.scrollTo(0, 0)); await capture('author'); await hold();
  await openMenu('Edit'); await capture('edit-menu'); await hold(); await page.keyboard.press('Escape');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('NEW LOOK', { exact: true }).selectOption(theme);
    for (const width of [1440, 1100, 760, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await openMenu('Edit'); await capture(`edit-${width}-${theme}`);
      const bounds = await menu('Edit').locator('.menu-popover').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await action('Edit', 'Analysis Settings');
      await explain(settings.getByRole('button', { name: 'Locale and date-format defaults', exact: true }), /UTC/);
      await capture(`settings-${width}-${theme}`);
      const box = await settings.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 901);
      // Native Chromium dialogs allow Tab into browser chrome (activeElement
      // becomes body), but never into background controls. Verify both paths.
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
        assert.equal(await settings.evaluate(node => node.matches(':modal') && (node.contains(document.activeElement) || document.activeElement === document.body)), true);
      }
      await settings.getByRole('button', { name: 'Cancel', exact: true }).focus();
      assert.equal(await settings.evaluate(node => { document.querySelector('.analysis-title input').focus(); return node.contains(document.activeElement); }), true);
      await page.keyboard.press('Escape'); check(`${width}px ${theme}: Edit and settings fit, explanations are reachable, background stays inert and Escape closes`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigate(page, 'data-prep'); await hold(); await navigate(page, 'data-sources'); await hold();
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ checks, errors, externalHTTPRequests: requests, frames: frame }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors: errors.length, externalHTTPRequests: requests.length, frames: frame }));
} catch (error) { await capture('failure'); writeFileSync(resolve(out, 'failure.json'), JSON.stringify({ checks, errors, externalHTTPRequests: requests, error: String(error) }, null, 2)); throw error; }
finally { await browser.close(); }
// ffmpeg -y -framerate 10 -i .opensight/issue-66/browser/gif/frames/f%03d.png -vf "scale=960:-1:flags=lanczos,palettegen" .opensight/issue-66/browser/gif/palette.png
// ffmpeg -y -framerate 10 -i .opensight/issue-66/browser/gif/frames/f%03d.png -i .opensight/issue-66/browser/gif/palette.png -lavfi "scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse" .opensight/issue-66/browser/gif/opensight-tour.gif
