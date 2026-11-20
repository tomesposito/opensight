// Captures an animated GIF storyboard for the repo README hero.
// Adapted from ~/workspace/tools/screenshots/readme-gif.mjs and its later tours.
// Drives the rebuilt file:// demo through Home, O, KPI target and trend authoring, Data prep and Sources.
// Frames land in OPENSIGHT_SCREENSHOT_OUTPUT/frames;
// See the bottom of this file for the ffmpeg assembly commands.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { navigate, openPropertySection } from './app-navigation.mjs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
import { mkdirSync } from 'fs';

const DEMO = new URL('../dist/opensight-demo.html', import.meta.url).href;
const FRAMES = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '/tmp/opensight-kpi-trend-tour', 'frames');
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.OPENSIGHT_CHROMIUM ?? '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [], external = [];
page.on('pageerror', e => errors.push(String(e && e.message || e).slice(0, 120)));
await page.route(/^https?:/, r => { external.push(r.request().url()); return r.abort(); });

let n = 0;
const snap = async () => {
  await page.screenshot({ path: `${FRAMES}/f${String(n++).padStart(3, '0')}.png` });
};
// Hold for ms, snapping roughly every 200ms (screenshot time included).
const hold = async ms => {
  for (let i = 0; i < Math.ceil(ms / 200); i++) await snap();
};
const setMode = mode => navigate(page, mode);

try {
  await page.goto(DEMO, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200); await hold(1200);
  await page.getByRole('button', { name: /Ask a question about/ }).click();
  await page.locator('#o-question').fill('revenue by region');
  await page.locator('#o-question').press('Enter');
  await page.locator('.o-result .chart svg').waitFor(); await hold(1600);
  await page.keyboard.press('Escape');
  await setMode('author');
  await page.getByRole('button', { name: 'KPI', exact: true }).click();
  await page.locator('.build-panel').getByRole('button', { name: 'Add visual', exact: true }).click();
  await page.getByRole('button', { name: 'Assign revenue', exact: true }).click();
  await page.getByLabel('Assign Trend group', { exact: true }).selectOption('order_date');
  await page.getByLabel('Assign Target value', { exact: true }).selectOption('profit');
  await page.locator('.author-card .chart svg').waitFor();
  if (await page.locator('.properties-panel').getAttribute('open') === null) await page.locator('.properties-panel > summary').click();
  await openPropertySection(page, 'Trend sort'); await hold(1400);
  await page.getByLabel('Trend sort descending', { exact: true }).click(); await hold(1600);
  assert.match(await page.locator('.fixture-notice').innerText(), /KPI target and trend previews aggregate synthetic sales rows/);
  await setMode('data-prep'); await hold(1400);
  await setMode('data-sources');
  await page.locator('.data-tools').getByRole('button', { name: 'Create data source', exact: true }).click();
  assert.equal(await page.getByRole('radio', { name: 'MySQL', exact: true }).isVisible(), true);
  await hold(1400);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('frames:', n, 'errors:', JSON.stringify(errors));
} finally { await browser.close(); }

// Assemble using the palettegen/paletteuse commands from readme-gif.mjs.
// With the default output directory:
// ffmpeg -y -framerate 10 -i /tmp/opensight-kpi-trend-tour/frames/f%03d.png -vf 'scale=960:-1:flags=lanczos,palettegen' /tmp/opensight-kpi-trend-tour/palette.png
// ffmpeg -y -framerate 10 -i /tmp/opensight-kpi-trend-tour/frames/f%03d.png -i /tmp/opensight-kpi-trend-tour/palette.png -lavfi 'scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse' docs/images/opensight-tour.gif
