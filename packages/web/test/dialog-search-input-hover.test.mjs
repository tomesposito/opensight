import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 48: hover feedback for the creation dialogs'
// search inputs. A fresh behavioral hover audit that OPENED both creation
// dialogs (real mouse hover + computed-style delta, Chromium, demo dist)
// found exactly two real zero-hover classes left in them:
// - the Create Analysis dialog's dataset search input (.dataset-picker-search
//   input, 420x34) measured white -> white, while the dialog's buttons and
//   its pagination select tinted (#edf7fc, base + slice 23 rules) — the
//   dialog had button and select hover rules but no input rule;
// - the Create Dataset dialog's search inputs (.data-dialog-tools
//   input[type=search], 260x28, both the dataset and connector stages)
//   measured white -> white, while the dialog's buttons tinted (slice 30).
//   Slice 27 gave .data-page search inputs hover but not .data-dialog ones
//   — the same unfinished-member pattern slice 30 fixed for dialog buttons.
// Each input takes its own surface's established hover tint: #edf7fc for
// the create-analysis dialog, #eaf3f7 (the data surface's menu tint) for
// the data dialog. Background only, so resting geometry is identical;
// disabled inputs keep their flat state. The audit's other zero-hover hits
// were the 13x13 native radio inputs inside the dataset table and the
// connector tiles — by-design native controls (slices 33/37/38 precedent);
// the connector tiles are a selection-card affordance, a separate lead.
// Static (no animation), so no reduced-motion variant is needed.
const dataCss = styles['data-section.css'];
const styleCss = styles['style.css'];

const dataRule = dataCss.match(/\.data-dialog\s+input\[type=search\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const createRule = styleCss.match(/\.create-analysis-dialog\s+input\[type=search\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the data-dialog search input has a hover state using the data menu tint', () => {
  assert.ok(dataRule, 'expected .data-dialog input[type=search]:hover:not(:disabled)');
  assert.match(dataRule[1], /background:\s*#eaf3f7/);
});

test('the create-analysis-dialog search input has a hover state using the dialog tint', () => {
  assert.ok(createRule, 'expected .create-analysis-dialog input[type=search]:hover:not(:disabled)');
  assert.match(createRule[1], /background:\s*#edf7fc/);
});

test('both hover rules are paint-only: resting geometry cannot shift', () => {
  assert.ok(dataRule && createRule, 'expected both dialog search hover rules');
  for (const [, body] of [dataRule, createRule]) {
    assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(body), 'hover must change background only');
  }
});

test('the resting input rules still reserve the geometry the hovers keep', () => {
  assert.match(dataCss, /\.data-page\s+input,\s*\.data-dialog\s+input[^{}]*\{[^}]*border:\s*1px\s+solid\s+#9eb0ba[^}]*background:\s*white/, 'data-dialog resting input rule must remain');
  assert.match(styleCss, /\.dataset-picker-search\s+input\s*\{[^}]*border:\s*1px\s+solid\s+#969da3[^}]*background:\s*#fff/, 'dataset-picker search resting rule must remain');
});

test('the new rules coexist with the earlier dialog hover rules', () => {
  assert.ok(dataCss.match(/\.data-dialog\s+button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'slice-30 data-dialog button rule must still be present');
  assert.ok(dataCss.match(/\.data-page\s+input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'slice-27 data-page search rule must still be present');
  assert.ok(styleCss.match(/\.create-analysis-dialog\s+button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7fc/), 'create-analysis button rule must still be present');
  assert.ok(styleCss.match(/\.create-analysis-dialog\s+select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7fc/), 'slice-23 create-analysis select rule must still be present');
});

defineHoverCases('dialog-search-input hover', {
  html: `
      <div class="data-dialog"><div class="data-dialog-tools"><input type="search" aria-label="Search data sources"><input type="search" aria-label="Disabled search" disabled></div></div>
      <dialog class="create-analysis-dialog" open><div class="dataset-picker-search"><input type="search" aria-label="Search datasets by name"></div></dialog>`,
  cases: [
    {
      target: '.data-dialog input:not([disabled])',
      rule: '.data-dialog input[type="search"]:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      excluded: [{ target: '.data-dialog input[disabled]', resting: { backgroundColor: 'rgb(255, 255, 255)' } }],
    },
    {
      target: '.create-analysis-dialog input',
      rule: '.create-analysis-dialog input[type="search"]:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 247, 252)' },
      paintOnly: true,
    },
  ],
});
