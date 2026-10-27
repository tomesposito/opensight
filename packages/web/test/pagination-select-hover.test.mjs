import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 23: hover feedback for the pagination "Items per
// page" selects. A fresh interactive-state audit (home/analyses/dashboards/
// data + the Create Analysis dialog; in-page CLS 0 on every route, no page
// errors, no slow scroll frames) found these two selects were the last
// interactive controls with zero hover state: hovering them changed nothing.
// - The Create Analysis dialog's select takes the dialog's established button
//   hover tint (#edf7fc, same rule family as the dialog's buttons).
// - The drafts collection's `.collection-pagination` select takes the
//   app-wide menu-item hover tint (#eaf3f7, slices 16/21).
// Both are background-only (paint, no geometry shift), disabled selects keep
// their flat state, and there is no animation so no reduced-motion variant is
// needed.
const styleCss = styles['style.css'];
const chromeCss = styles['app-chrome.css'];

const dialogRule = styleCss.match(/\.create-analysis-dialog\s+select:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const collectionRule = chromeCss.match(/\.collection-pagination\s+select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the Create Analysis dialog pagination select has a hover state with the dialog tint', () => {
  assert.ok(dialogRule, 'expected .create-analysis-dialog select:hover:not(:disabled)');
  assert.match(dialogRule[1], /background:\s*#edf7fc/);
});

test('the drafts collection pagination select has a hover state with the menu tint', () => {
  assert.ok(collectionRule, 'expected .collection-pagination select:hover:not(:disabled)');
  assert.match(collectionRule[1], /background:\s*#eaf3f7/);
});

test('both hover rules are paint-only: resting geometry cannot shift', () => {
  for (const [name, rule] of [['dialog', dialogRule], ['collection', collectionRule]]) {
    assert.ok(rule, `expected ${name} hover rule`);
    assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(rule[1]), `${name}: hover must change background only`);
  }
});

test('the dialog select resting rule still reserves the geometry the hover keeps', () => {
  const base = styleCss.match(/\.create-analysis-dialog\s+button,\s*\.create-analysis-dialog\s+select\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the dialog base control rule');
  assert.match(base[1], /background:\s*#fff/);
});

defineHoverCases('pagination-select hover', {
  html: `<dialog class="create-analysis-dialog" open><div class="dataset-picker-pagination"><label>Items per page <select id="dlg"><option>25</option></select></label></div></dialog>`
      + `<section class="local-drafts"><div class="collection-pagination"><label>Items per page <select id="col"><option>25</option></select></label><select id="dis" disabled><option>25</option></select></div></section>`,
  cases: [
    {
      target: '#dlg',
      rule: '.create-analysis-dialog select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 247, 252)' },
      paintOnly: true,
    },
    {
      target: '#col',
      rule: '.collection-pagination select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      excluded: [{ target: '#dis', resting: { backgroundColor: 'rgb(255, 255, 255)' } }],
    },
  ],
});
