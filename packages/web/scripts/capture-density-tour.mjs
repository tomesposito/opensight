// Issue #41: density and issue #4 header regressions on the rebuilt offline demo.
// Private screenshots and reports go outside the repository; all HTTP(S) is blocked.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');

const REF = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/home/hatch/workspace/goals/opensight/hidden_files/lookfeel-references/issue-41');
await mkdir(REF, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], requests = [], contrasts = [], captures = [], responsive = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
const menu = page.getByRole('navigation', { name: 'Analysis menu' });
const file = menu.locator('details').filter({ has: page.locator('summary', { hasText: /^File$/ }) });
const fit = page.getByRole('button', { name: 'FIT TO WIDTH', exact: true });
const publish = page.getByRole('button', { name: 'PUBLISH', exact: true });
const toggle = page.getByLabel('NEW LOOK', { exact: true });
const settle = () => page.waitForTimeout(250);
const capture = async (name, options = {}) => {
  await page.screenshot({ animations: 'disabled' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(REF, `${name}.png`), animations: 'disabled', ...options });
  captures.push(name);
  console.log(`captured ${name}`);
};
const checkContrast = async (locator, name, pseudo) => {
  const colors = await locator.evaluate((node, pseudo) => {
    const style = getComputedStyle(node, pseudo);
    let bg = style.backgroundColor, parent = node;
    while (bg === 'rgba(0, 0, 0, 0)') {
      parent = parent.parentElement;
      if (!parent) throw new Error('No opaque background');
      bg = getComputedStyle(parent).backgroundColor;
    }
    return { foreground: style.color, background: bg };
  }, pseudo);
  const lum = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const a = lum(colors.foreground), b = lum(colors.background);
  const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  if (name.startsWith('dark ') && !name.includes('popover')) {
    const light = contrasts.find(c => c.name === name.replace(/^dark /, 'light '));
    assert.equal(colors.foreground, light.foreground, `${name} inherits shared header foreground`);
    assert.equal(colors.background, light.background, `${name} inherits shared header background`);
  }
  contrasts.push({ name, ...colors, ratio: Number(ratio.toFixed(2)) });
  assert.ok(ratio >= 4.5, `${name}: ${ratio.toFixed(2)}:1 ${JSON.stringify(colors)}`);
};
try {
  await page.goto(new URL('../dist/opensight-demo.html', import.meta.url).href, { waitUntil: 'networkidle' });
  await navigate(page, 'author');
  await menu.getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByRole('button', { name: 'Assign region', exact: true }).click();
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0)); await settle();
  const layout = await page.locator('.author-layout').evaluate(node => [...node.children].map(n => Math.round(n.getBoundingClientRect().width)));
  assert.deepEqual(layout, [190, 216, 758, 220]);
  const navBox = await menu.boundingBox();
  assert.equal(navBox.x, 0); assert.equal(navBox.width, 1440);
  assert.equal(await menu.evaluate(n => getComputedStyle(n).borderRadius), '0px');
  const positions = await page.locator('.author-menu > details:last-of-type, .author-menu .q-trigger, .author-menu > button, .chrome-switch').evaluateAll(nodes => nodes.map(n => ({ x: n.getBoundingClientRect().x, y: n.getBoundingClientRect().y })));
  assert.ok(positions.every((p, i) => i === 0 || p.x > positions[i - 1].x), 'desktop control order');
  assert.ok(positions.every(p => p.y >= navBox.y && p.y < navBox.y + navBox.height));
  const headerClip = { x: 0, y: 0, width: 1440, height: Math.ceil(navBox.y + navBox.height) };

  for (const theme of ['light', 'dark']) {
    await toggle.selectOption(theme); await page.mouse.move(1438, 899); await settle();
    await page.evaluate(() => window.scrollTo(0, 0));
    await checkContrast(page.locator('.analysis-title input'), `${theme} identity title`);
    await checkContrast(toggle, `${theme} NEW LOOK`);
    await checkContrast(page.locator('.chrome-switch'), `${theme} NEW LOOK label`);
    await checkContrast(menu.locator('.q-trigger'), `${theme} Ask Q`);
    await checkContrast(file.locator('summary'), `${theme} menu`);
    await file.locator('summary').hover();
    await checkContrast(file.locator('summary'), `${theme} menu hover`);
    await file.locator('summary').focus();
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    await checkContrast(file.locator('summary'), `${theme} menu focus`);
    assert.equal(await file.locator('summary').evaluate(n => getComputedStyle(n).outlineStyle), 'solid');
    await page.keyboard.press('Enter');
    assert.equal(await file.evaluate(n => n.open), true);
    await checkContrast(file.locator('summary'), `${theme} menu open`);
    await checkContrast(file.locator('.menu-popover button').first(), `${theme} popover action`);
    await checkContrast(file.locator('.menu-popover p'), `${theme} popover hint`);
    await file.locator('.menu-popover button').first().hover();
    await checkContrast(file.locator('.menu-popover button').first(), `${theme} popover hover`);
    const popoverBox = await file.locator('.menu-popover').boundingBox();
    await page.mouse.move(1438, 899);
    await capture(`menu-${theme}`, { clip: { x: 0, y: 0, width: 1440, height: 340 } });
    assert.ok(Math.abs(popoverBox.y - (navBox.y + navBox.height)) < 2, 'popover anchors to menu bottom');
    await page.mouse.move(1438, 899);
    await file.locator('.menu-popover button').first().focus();
    await page.keyboard.press('Escape');
    assert.equal(await file.evaluate(n => n.open), false);
    assert.equal(await file.locator('summary').evaluate(n => n === document.activeElement), true);
    await fit.focus();
    await checkContrast(fit, `${theme} fit on`);
    await fit.hover(); await checkContrast(fit, `${theme} fit on hover`);
    await fit.click();
    assert.equal(await fit.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.canvas-viewport').getAttribute('data-fit'), 'actual');
    await page.mouse.move(1438, 899); await checkContrast(fit, `${theme} fit off`);
    await fit.hover(); await checkContrast(fit, `${theme} fit off hover`);
    await fit.click();
    assert.equal(await page.locator('.canvas-viewport').getAttribute('data-fit'), 'width');
    await page.mouse.move(1438, 899); await checkContrast(publish, `${theme} publish`);
    await publish.hover(); await checkContrast(publish, `${theme} publish hover`);
    await publish.click();
    assert.match(await page.locator('.toolbar-notice[role=status]').innerText(), /no publication destination.*Nothing has been published/s);
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await page.locator('.analysis-title input').focus();
    await page.keyboard.press('Tab');
    await page.locator(':focus').evaluate(n => n.blur());
    await page.mouse.move(1438, 899); await settle();
    await capture(`header-${theme}`, { clip: headerClip });
    await capture(`author-${theme}`);
    await capture(`author-${theme}-full`, { fullPage: true });
  }
  const density = await page.evaluate(() => Object.fromEntries(['.author-layout', '.author-center', '.canvas-viewport', '.fields-panel > summary', '.field-group button', '.visual-gallery', '.field-wells', '.property-section', '.sheet-toolbar', '.controls-strip', '.author-card-toolbar'].map(selector => {
    const node = document.querySelector(selector), rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, font: style.fontFamily, fontSize: style.fontSize }];
  })));
  // Outside-click closure and Edit focus still use the existing workspace selectors.
  await file.locator('summary').click();
  await page.locator('.analysis-title input').click();
  assert.equal(await file.evaluate(n => n.open), false);
  await menu.locator('summary').filter({ hasText: /^Edit$/ }).click();
  await page.getByRole('button', { name: 'Rename analysis', exact: true }).click();
  assert.equal(await page.locator('.analysis-title input').evaluate(n => n === document.activeElement), true);
  // The toolbar opens Q in the shared side panel.
  await menu.getByRole('button', { name: /^Ask a question about / }).click();
  await page.getByRole('searchbox', { name: 'Ask a question', exact: true }).fill('sum revenue by region');
  await page.getByRole('dialog', { name: 'ASK Q', exact: true }).getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator('.o-result .chart svg').waitFor();
  assert.equal(await page.locator('.q-side-panel .o-answer').count(), 1);
  assert.match(await page.locator('.o-mode-notice').innerText(), /Needs hosted API/);
  await page.getByRole('button', { name: 'Close answer', exact: true }).click();
  await page.getByRole('button', { name: 'Close Ask Q', exact: true }).click();
  await toggle.selectOption('light');
  await page.evaluate(() => document.activeElement?.blur()); await settle();
  await page.locator('.author-card').scrollIntoViewIfNeeded(); await settle();
  await page.evaluate(() => window.scrollTo(0, 0)); await settle();
  await capture('author-overview');
  await capture('author-full', { fullPage: true });

  // Native utility disclosures remain operable in place and never overlay the sheet.
  for (const selector of ['.local-drafts', '.bundle-import details']) {
    const disclosure = page.locator(selector), summary = disclosure.locator(':scope > summary');
    await summary.focus(); await page.keyboard.press('Enter');
    assert.equal(await disclosure.evaluate(node => node.open), true);
    const bottom = await disclosure.evaluate(node => node.getBoundingClientRect().bottom);
    assert.ok((await page.locator('.author-layout').boundingBox()).y >= bottom);
    await summary.press('Space');
    assert.equal(await disclosure.evaluate(node => node.open), false);
  }
  assert.match(await page.locator('.fixture-notice').innerText(), /fixed sample results.*region = East.*No live queries run/s);
  assert.match(await page.locator('.dataset-metadata').innerText(), /sample rows.*offline demo.*needs hosted API/s);
  assert.match(await page.locator('.app-footer').innerText(), /visual fidelity not measured/i);
  for (const width of [1920, 1440, 1400, 1399, 1366, 1280, 1101, 1100, 760, 390]) {
    await page.setViewportSize({ width, height: 900 }); await settle();
    const geometry = await page.locator('.author-layout').evaluate(node => ({
      width: node.getBoundingClientRect().width,
      regions: [...node.children].map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, right: r.right }; }),
    }));
    responsive.push({ viewportWidth: width, ...geometry });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no overflow at ${width}`);
    if (width > 1100) {
      assert.ok(geometry.regions[2].width > geometry.width / 2, `sheet majority at ${width}`);
      for (let i = 1; i < 4; i++) assert.ok(geometry.regions[i].x >= geometry.regions[i - 1].right, `dock order at ${width}`);
    }
    for (const selector of ['.local-drafts', '.bundle-import details']) {
      const summary = page.locator(`${selector} > summary`);
      await summary.click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `expanded utility fits at ${width}`);
      await summary.click();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await settle();
  for (const panelName of ['fields', 'build', 'properties']) {
    const panel = page.locator(`.${panelName}-panel`), heading = panel.locator(':scope > summary');
    const sheetWidth = (await page.locator('.author-center').boundingBox()).width;
    await heading.press('Enter'); await settle();
    assert.ok((await page.locator('.author-center').boundingBox()).width > sheetWidth);
    await heading.press('Space'); await settle();
    assert.equal((await page.locator('.author-center').boundingBox()).width, sheetWidth);
  }
  const lastType = page.locator('.visual-gallery button').last();
  await lastType.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  assert.equal(await lastType.evaluate(node => node === document.activeElement), true);
  const gallery = await page.locator('.visual-gallery').boundingBox(), lastBox = await lastType.boundingBox();
  assert.ok(lastBox.y >= gallery.y && lastBox.y + lastBox.height <= gallery.y + gallery.height + 1);
  await page.locator('.visual-gallery').evaluate(node => node.scrollTop = 0);
  await page.locator('.build-panel').evaluate(node => node.scrollTop = 0);

  for (const width of [1100, 760, 390]) {
    await page.setViewportSize({ width, height: 900 }); await settle();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no page overflow at ${width}`);
    await file.locator('summary').click(); await settle();
    const box = await file.locator('.menu-popover').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `popover fits at ${width}`);
    await file.locator('summary').focus(); await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await toggle.selectOption('dark');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await navigate(page, 'author');
  assert.equal(await toggle.inputValue(), 'dark', 'NEW LOOK persists through reload');
  assert.equal(await page.locator('.author-card').count(), 1);
  await navigate(page, 'fixtures');
  assert.equal(await page.locator('.author-workspace').count(), 0);
  assert.equal(await page.locator('.app-header').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)', 'other modes keep their chrome');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  const report = { viewport: '1440x900', screenshots: captures, pageErrors: errors, externalRequests: requests, layout, density, responsive, contrasts, keyboard: 'passed', fit: 'passed', publish: 'passed', q: 'passed', persistence: 'passed', narrow: 'passed', otherModes: 'passed' };
  await writeFile(resolve(REF, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, contrasts: `${contrasts.length} checks; minimum ${Math.min(...contrasts.map(c => c.ratio))}:1`, responsive: responsive.map(r => r.viewportWidth) }));
} finally { await browser.close(); }
