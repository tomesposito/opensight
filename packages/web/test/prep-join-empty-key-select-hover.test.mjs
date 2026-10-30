import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 final audit: hover feedback for the empty join
// key-column select (.data-prep .prep-key-column.empty select — the
// dashed placeholder dropdown in PrepJoinEditor.tsx, where the next
// join key is picked). The exhaustive final audit (static extraction
// of every interactive element in packages/web/src, contexts resolved
// through the component graph, computed style at rest vs hover in
// Chromium with all five shipped stylesheets) found it was a
// rule-but-no-change surface: .data-prep select:hover (#e8eefb)
// matches it, but ties the empty resting rule (.prep-key-column.empty
// select, white) on specificity — 0-3-1 each once :not(:disabled) is
// counted — and loses on source order, so hovering the empty select
// changed nothing. The non-empty key select (resting #f5fbff at
// 0-2-1) hovers correctly, and the label wrapping both takes the
// slice-104 key-column label hover. The empty select — a live
// dropdown, not a disabled state — now takes the same prep tint
// #e8eefb on hover, so no new colour is introduced. Background only,
// so resting geometry is identical and there is no animation.
const styleCss = styles['style.css'];

const emptyHover = styleCss.match(/^\.data-prep \.prep-key-column\.empty select:hover:not\(:disabled\)\s*\{([^}]*)\}/m);

test('the empty key-column select hover rule exists with the prep tint', () => {
  assert.ok(emptyHover, 'expected the empty key-column select :hover rule');
  assert.match(emptyHover[1], /background:\s*#e8eefb/);
});

test('the hover tint matches the general prep select hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#e8eefb/), 'the general prep select hover must remain #e8eefb');
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(emptyHover, 'expected the empty key-column select :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(emptyHover[1]), 'hover must change background only');
});

test('the resting key-column select rules are preserved', () => {
  assert.ok(styleCss.match(/\.data-prep \.prep-key-column\.empty select\s*\{[^}]*border-style:\s*dashed[^}]*background:\s*#fff/), 'the empty key select resting rule must remain');
  assert.ok(styleCss.match(/\.data-prep \.prep-key-column select\s*\{[^}]*background:\s*#f5fbff/), 'the non-empty key select resting rule must remain');
});

defineHoverCases('prep-join-empty-key-select hover', {
  html: `<div class="data-prep"><div class="prep-join-editor"><div class="prep-join-keys">`
      + `<label class="prep-key-column empty"><select id="emptySelect"><option>Choose a column</option></select></label>`
      + `<label class="prep-key-column"><select id="filledSelect"><option>region</option></select></label>`
      + `</div></div></div>`
      + `<div class="data-prep"><label class="prep-key-column empty"><select id="disabledSelect" disabled><option>Choose a column</option></select></label></div>`,
  cases: [
    {
      target: '#emptySelect',
      rule: '.data-prep .prep-key-column.empty select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
      excluded: ['#disabledSelect'],
    },
    {
      target: '#filledSelect',
      rule: '.data-prep select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(245, 251, 255)' },
      hovered: { backgroundColor: 'rgb(232, 238, 251)' },
      paintOnly: true,
    },
  ],
});
