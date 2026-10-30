import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 16: hover feedback for the Data landing's create
// controls. A fresh audit of interactive elements found the teal create
// buttons (Create dataset split button + caret, New analysis on the Analyses
// landing) and the unselected data tabs (Datasets/Topics/Data sources) had no
// hover state — clicks felt dead. The teal controls darken #2f66d8 -> #1e4fa3
// (the same ~13% step the app-wide #3b82f6 -> #2f66d8 primary-button hover
// uses); plain buttons and unselected tabs take the data page's established
// menu-item hover tint (#e8eefb). Disabled controls and the selected tab keep
// their flat state.
const sectionCss = styles['data-section.css'];
const styleCss = styles['style.css'];

test('teal data-page primary buttons darken on hover', () => {
  const rule = sectionCss.match(
    /\.data-page\s+\.data-primary:hover:not\(:disabled\),\s*\.data-dialog\s+\.data-primary:hover:not\(:disabled\),\s*\.data-split\s*>\s*\.data-menu\s*>\s*summary:hover\s*\{([^}]*)\}/,
  );
  assert.ok(rule, 'expected the data-primary/split-button hover rule');
  assert.match(rule[1], /background:\s*#1e4fa3/);
});

test('plain data-page buttons take the menu-item hover tint', () => {
  const rule = sectionCss.match(
    /\.data-page\s+button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{([^}]*)\}/,
  );
  assert.ok(rule, 'expected the plain data-page button hover rule');
  assert.match(rule[1], /background:\s*#e8eefb/);
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
  assert.match(rule[1], /background:\s*#2f66d8/);
});

const primaryRule = '.data-page .data-primary:hover:not(:disabled), .data-dialog .data-primary:hover:not(:disabled), .data-split > .data-menu > summary:hover';
defineHoverCases('data create controls', {
  html: `<section class="data-page">
    <button id="primary" class="data-primary">Create dataset</button>
    <button id="disabled" class="data-primary" disabled>Unavailable</button>
    <button id="plain">Refresh</button>
    <div class="data-tabs"><button id="tab" aria-selected="false">Sources</button><button id="selected" aria-selected="true">Datasets</button></div>
    <div class="data-split"><details class="data-menu"><summary id="split">Create options</summary></details></div>
  </section>
  <dialog class="data-dialog" open><button id="dialog" class="data-primary">Continue</button></dialog>
  <section class="analyses-home"><a id="analysis" class="primary-button" href="#">New analysis</a></section>`,
  cases: [
    ...['#primary', '#dialog', '#split'].map(target => ({
      target, rule: primaryRule,
      resting: { backgroundColor: 'rgb(47, 102, 216)' },
      hovered: { backgroundColor: 'rgb(30, 79, 163)' },
      paintOnly: true,
      excluded: ['#disabled', '#plain'],
    })),
    ...['#plain', '#tab'].map(target => ({
      target, rule: '.data-page button:hover:not(:disabled):not(.data-primary):not([aria-selected=true])',
      resting: { backgroundColor: target === '#plain' ? 'rgb(255, 255, 255)' : 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      excluded: ['#disabled', '#selected', '#primary'],
    })),
    {
      target: '#analysis', rule: '.analyses-home .primary-button:hover',
      resting: { backgroundColor: 'rgb(59, 130, 246)' },
      hovered: { backgroundColor: 'rgb(47, 102, 216)' },
      paintOnly: true,
    },
  ],
});
