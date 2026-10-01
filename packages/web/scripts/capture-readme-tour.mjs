// Captures an animated GIF storyboard for the repo README hero.
// Adapted from ~/workspace/tools/screenshots/readme-gif.mjs.
// Drives the rebuilt file:// demo through Home, O, Author, Analyses, Data, Admin.
// Frames land in OPENSIGHT_SCREENSHOT_OUTPUT/frames;
// assemble with: ffmpeg -framerate 10 -i .opensight/issue-31/gif/frames/f%03d.png ...
// (see the bottom of this file for the exact assembly command).
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { navigate } from './app-navigation.mjs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(resolve(process.env.OPENSIGHT_SCREENSHOT_TOOLS ?? '/home/hatch/workspace/tools/screenshots', 'package.json'))('playwright-core');
import { mkdirSync } from 'fs';

const DEMO = new URL('../dist/opensight-demo.html', import.meta.url).href;
const FRAMES = resolve(process.env.OPENSIGHT_SCREENSHOT_OUTPUT ?? '.opensight/issue-31/gif', 'frames');
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e && e.message || e).slice(0, 120)));
await page.route(/^https?:/, r => r.abort());

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
  await page.waitForTimeout(1800);
  await hold(1500); // 1. dashboard with charts

  // 2. Ask the O bar a question, typing visibly.
  await page.click('#o-question');
  await hold(400);
  for (const ch of 'revenue by region') {
    await page.press('#o-question', ch === ' ' ? ' ' : ch);
    if (n % 2 === 0) await snap();
    await page.waitForTimeout(70);
  }
  await hold(500);
  await page.press('#o-question', 'Enter'); // 3. answer renders
  await page.locator('.o-result .chart svg').waitFor();
  assert.match(await page.locator('.o-source').innerText(), /^Offline demo:/);
  await hold(2800);
  await hold(1200);

  // Author and its Analyses home share the same device-local store.
  await setMode('author');
  await page.locator('#o-question').fill('revenue by region');
  await page.locator('#o-question').press('Enter');
  await page.locator('.o-result .chart svg').waitFor();
  await hold(1400);
  await page.getByRole('button', { name: 'ADD TO ANALYSIS', exact: true }).click();
  await page.getByLabel('Analysis title', { exact: true }).fill('Revenue analysis');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.locator('.author-card .chart svg').waitFor();
  await hold(1200);
  await setMode('analyses');
  await hold(1800);

  // 4. Data preparation pipeline canvas.
  await setMode('data-prep');
  await page.waitForTimeout(900);
  await hold(2200);

  // 5. Data source connector gallery. End.
  await setMode('data-sources');
  await page.waitForTimeout(900);
  await hold(1600);

  await setMode('security'); await hold(1400);
  assert.deepEqual(errors, []);
  console.log('frames:', n, 'errors:', JSON.stringify(errors.slice(0, 4)));
} finally {
  await browser.close();
}

// Assembly (run after):
// ffmpeg -y -framerate 10 -i .opensight/issue-31/gif/frames/f%03d.png -vf "scale=960:-1:flags=lanczos,palettegen" .opensight/issue-31/gif/palette.png
// ffmpeg -y -framerate 10 -i .opensight/issue-31/gif/frames/f%03d.png -i .opensight/issue-31/gif/palette.png -lavfi "scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse" .opensight/issue-31/gif/opensight-tour.gif
