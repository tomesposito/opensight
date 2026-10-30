import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromiumPage } from './chromium.mjs';
import { checkHoverCase, defineHoverCase, loadInteractionFixture } from './interaction.mjs';

const rule = '.author-workspace select:hover:not(:disabled)';
const expectation = {
  target: '#palette', rule,
  resting: { backgroundColor: 'rgb(255, 255, 255)' },
  hovered: { backgroundColor: 'rgb(238, 243, 253)' },
};

defineHoverCase('full stylesheet hover, disabled exclusion and dark override', {
  ...expectation,
  html: '<div class="author-workspace"><select id="palette"><option>Coastal</option></select><select id="disabled" disabled><option>Disabled</option></select></div>',
  excluded: ['#disabled'],
  dark: {
    html: '<div class="author-workspace" data-chrome="dark"><select id="palette"><option>Coastal</option></select><select id="disabled" disabled><option>Disabled</option></select></div>',
    rule: '.author-workspace[data-chrome=dark] select:hover:not(:disabled)',
    resting: { backgroundColor: 'rgb(32, 46, 64)' },
    hovered: { backgroundColor: 'rgb(54, 72, 106)' },
  },
});

let page;
before(async () => { page = await chromiumPage(); });
after(async () => { await page?.close(); });

test('a matching tint cannot hide a non-applicable hover selector', async () => {
  await loadInteractionFixture(page, '<select id="palette" style="background: #eef3fd"><option>Coastal</option></select>');
  await assert.rejects(checkHoverCase(page, {
    ...expectation, resting: expectation.hovered,
  }), /matches .* while hovered/);
});

test('a higher-priority override is observed instead of bypassed', async () => {
  await loadInteractionFixture(page, '<div class="author-workspace"><select id="palette" style="background: white !important"><option>Coastal</option></select></div>');
  await assert.rejects(checkHoverCase(page, expectation), /#palette hovered: backgroundColor/);
});

test('hover propagates to ancestors, clears between targets and survives fixture replacement', async () => {
  await loadInteractionFixture(page, '<label class="toggle" id="label"><input id="box" type="checkbox">Enabled</label><button id="other">Other</button>');
  await page.setHovered('#box');
  assert.deepEqual(await page.evaluate(() => ({
    background: getComputedStyle(document.querySelector('#label')).backgroundColor,
  })), { background: 'rgb(238, 243, 253)' });
  assert.equal((await page.hoverState('#box')).hovered, true);
  assert.equal((await page.hoverState('#label')).hovered, true);
  await page.setHovered('#other');
  assert.equal((await page.hoverState('#label')).hovered, false);
  await loadInteractionFixture(page, '<div id="replacement">Replacement</div>');
  await page.setHovered('#replacement');
  await page.setHovered(null);
  assert.equal(!(await page.hoverState('#replacement')).hovered, true);
  await assert.rejects(page.setHovered('#missing'), /Cannot hover missing element/);
});
