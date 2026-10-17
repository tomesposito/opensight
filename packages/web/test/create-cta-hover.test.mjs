import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #108 polish slice 16: hover feedback for the Data landing's create
// controls. A fresh audit of interactive elements found the teal create
// buttons (Create dataset split button + caret, New analysis on the Analyses
// landing) and the unselected data tabs (Datasets/Topics/Data sources) had no
// hover state — clicks felt dead. The teal controls darken #176b88 -> #145d76
// (the same ~13% step the app-wide #157f88 -> #126e76 primary-button hover
// uses); plain buttons and unselected tabs take the data page's established
// menu-item hover tint (#eaf3f7). Disabled controls and the selected tab keep
// their flat state.
const sectionCss = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('teal data-page primary buttons darken on hover', () => {
  const rule = sectionCss.match(
    /\.data-page\s+\.data-primary:hover:not\(:disabled\),\s*\.data-dialog\s+\.data-primary:hover:not\(:disabled\),\s*\.data-split\s*>\s*\.data-menu\s*>\s*summary:hover\s*\{([^}]*)\}/,
  );
  assert.ok(rule, 'expected the data-primary/split-button hover rule');
  assert.match(rule[1], /background:\s*#145d76/);
});

test('plain data-page buttons take the menu-item hover tint', () => {
  const rule = sectionCss.match(
    /\.data-page\s+button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{([^}]*)\}/,
  );
  assert.ok(rule, 'expected the plain data-page button hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('hover never overrides the disabled or selected-tab state', () => {
  assert.ok(
    sectionCss.includes(':hover:not(:disabled):not(.data-primary):not([aria-selected=true])'),
    'hover must exclude disabled, .data-primary, and the selected tab',
  );
  const disabled = sectionCss.match(/\.data-page\s+button:disabled[^{]*\{([^}]*)\}/);
  assert.ok(disabled, 'expected the disabled rule to remain');
  assert.match(disabled[1], /cursor:\s*not-allowed/);
});

test('analyses-home primary-button hover matches the app-wide language', () => {
  const rule = styleCss.match(/\.analyses-home\s+\.primary-button:hover\s*\{([^}]*)\}/);
  assert.ok(rule, 'expected .analyses-home .primary-button:hover');
  assert.match(rule[1], /background:\s*#126e76/);
});
