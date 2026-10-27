import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 64: hover feedback for inputs inside a
// collection card (.collection-card input in app-chrome.css) — the
// drafts search field (.draft-collection-tools input[type=search]) and
// the rename field (.draft-rename input) of the expanded LocalDrafts
// collection on the Analyses home page (LocalDrafts.tsx via
// Analyses.tsx inside CollectionPage's .collection-card). Static audit
// follow-on to slices 59-63: buttons in the same card tint
// (.collection-card button:hover -> #eaf4f4) and the pagination select
// tints (.collection-pagination select:hover -> #eaf3f7, slice 23), but
// no :hover rule in any stylesheet reached a .collection-card input —
// the search-input hover rules are scoped to .author-workspace /
// .data-page — and a real-mouse Chromium probe measured the search and
// rename fields white -> white on hover. The expanded collection only
// renders when local drafts exist, so empty-state route audits never
// reach these fields (the slices 50/62 blind spot). The fields now take
// #eaf3f7, the collection surface's own field hover tint (the slice-23
// pagination select in the same card). Background only, so resting
// geometry is identical. Static (no animation), so no reduced-motion
// variant is needed; radio/checkbox inputs are excluded so the
// favorites-filter checkbox keeps its native rendering (the
// data-dialog / admin-settings pattern), and file inputs likewise.
const css = styles['app-chrome.css'];

const inputHover = css.match(/\.collection-card input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\)\s*\{([^}]*)\}/);

test('the collection-card input hover rule exists with the collection field tint', () => {
  assert.ok(inputHover, 'expected the collection-card input hover rule');
  assert.match(inputHover[1], /background:\s*#eaf3f7/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(inputHover, 'expected the collection-card input hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(inputHover[1]), 'hover must change background only');
});

test('the resting collection-card rules are preserved', () => {
  const input = css.match(/^\.collection-card input\s*\{([^}]*)\}/m);
  assert.ok(input, 'expected the collection-card input resting rule');
  assert.match(input[1], /min-width:\s*0/);
  const shared = css.match(/\.collection-card button, \.collection-card select, \.collection-card input\s*\{([^}]*)\}/);
  assert.ok(shared, 'expected the shared collection-card control resting rule');
  assert.match(shared[1], /background:\s*#fff/);
});

test('the neighbouring collection hover rules are untouched', () => {
  assert.ok(css.match(/\.collection-card button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf4f4/), 'the collection-card button hover rule must still be present');
  assert.ok(css.match(/\.collection-pagination select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection-pagination select hover rule must still be present');
});

defineHoverCases('collection-card-input hover', {
  html: `<div class="collection-card">
      <div class="draft-collection-tools"><label>Search analyses<input id="search" type="search" /></label></div>
      <form class="draft-rename"><label>Draft name<input id="rename" value="Q3 sales" /></label></form>
      <input id="off" disabled />
      <label class="favorites-filter"><input id="fav" type="checkbox" />Favorites only</label>
    </div>`,
  cases: [
    {
      target: '#search',
      rule: '.collection-card input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"])',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      excluded: ['#off', '#fav'],
    },
    {
      target: '#rename',
      rule: '.collection-card input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"])',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
    },
  ],
});
