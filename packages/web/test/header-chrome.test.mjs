import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Read the shipped stylesheet so changing a UI token also changes the test input.
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const declarations = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  assert.ok(body, `Missing rule: ${selector}`);
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]+)\s*;/gi)].map(m => [m[1], m[2]]));
};
const luminance = hex => {
  assert.match(hex, /^#(?:[\da-f]{3}|[\da-f]{6})$/i);
  const rgb = hex.length === 4 ? [...hex.slice(1)].map(c => c + c).join('') : hex.slice(1);
  return rgb.match(/../g).map(c => parseInt(c, 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

for (const theme of ['light', 'dark']) {
  const tokens = { ...declarations('.author-workspace'), ...(theme === 'dark' ? declarations('.author-workspace[data-chrome=dark]') : {}) };
  for (const [label, foreground, background] of [
    ['identity', '--header-text', '--header-bg'],
    ['identity secondary text', '--header-muted', '--header-bg'],
    ['menu / publish / fit off', '--header-text', '--header-menu-bg'],
    ['hover / focus', '--header-text', '--header-hover'],
    ['open / pressed', '--header-text', '--header-pressed'],
    ['fit on', '--header-selected-text', '--header-selected-bg'],
    ['fit on hover', '--header-selected-text', '--header-selected-hover'],
    ['popover', '--chrome-text', '--chrome-surface'],
    ['popover hint', '--chrome-muted', '--chrome-surface'],
  ]) test(`NEW LOOK ${theme}: ${label} text meets WCAG AA 4.5:1`, () => {
    const ratio = contrast(tokens[foreground], tokens[background]);
    assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
  });
}
