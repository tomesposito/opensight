import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 final audit: hover feedback for the selected connector
// card (.app-shell .connector-card.selected in DataSources.tsx — the
// button card for the currently chosen connector in the Create a data
// set gallery). The exhaustive final audit (static extraction of every
// interactive element in packages/web/src, contexts resolved through
// the component graph, computed style at rest vs hover in Chromium
// with all five shipped stylesheets) found the selected card was a
// rule-but-no-change surface: .connector-card:hover (style.css,
// #f8fbff) matches it, but loses the cascade to .app-shell
// .connector-card.selected (app-chrome.css, #eaf4f4; specificity 0-3-0
// over 0-2-0), so hovering the selected card changed nothing while
// unselected cards tint to #f8fbff. The selected card now deepens to
// #dceff0 — the app shell's own control hover tint (.product-
// navigation links, .rail-search, the workspace-banner button of
// slice 62, which made the same choice for a control resting on
// #eaf4f4 because the lighter menu tints would blend into it) — so it
// stays visually distinct at rest and still reads interactive.
// Background only, so resting geometry is identical; no animation, so
// no reduced-motion variant is needed.
const appChromeCss = styles['app-chrome.css'];
const styleCss = styles['style.css'];

const selectedHover = appChromeCss.match(/^\.app-shell \.connector-card\.selected:hover\s*\{([^}]*)\}/m);

test('the selected connector card hover rule exists with the shell tint', () => {
  assert.ok(selectedHover, 'expected the selected connector-card hover rule');
  assert.match(selectedHover[1], /background:\s*#dceff0/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(selectedHover, 'expected the selected connector-card hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(selectedHover[1]), 'hover must change background only');
});

test('the resting selected-card rule and the unselected card hover are preserved', () => {
  assert.ok(appChromeCss.match(/\.app-shell \.connector-card\.selected\s*\{[^}]*background:\s*#eaf4f4/), 'the app-shell selected card resting rule must remain');
  assert.ok(styleCss.match(/\.connector-card:hover\s*\{[^}]*background:\s*#f8fbff/), 'the unselected card hover must remain #f8fbff');
  assert.ok(styleCss.match(/\.connector-card\.selected\s*\{[^}]*background:\s*#f4faff/), 'the base selected card resting rule must remain');
});

test('the tint is the established shell-control hover tint, so no new colour is introduced', () => {
  assert.ok(appChromeCss.match(/\.workspace-banner button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#dceff0/), 'the workspace-banner button hover must remain #dceff0');
});

defineHoverCases('connector-card-selected hover', {
  html: `<div class="app-shell"><section class="data-sources"><div class="connector-grid">`
      + `<button type="button" class="connector-card connector-featured selected" id="selectedCard">File</button>`
      + `<button type="button" class="connector-card" id="plainCard">PostgreSQL</button>`
      + `</div></section></div>`
      + `<button type="button" class="connector-card selected" id="outsideCard">Outside</button>`,
  cases: [
    {
      target: '#selectedCard',
      rule: '.app-shell .connector-card.selected:hover',
      resting: { backgroundColor: 'rgb(234, 244, 244)' },
      hovered: { backgroundColor: 'rgb(220, 239, 240)' },
      paintOnly: true,
      excluded: ['#outsideCard'],
    },
    {
      target: '#plainCard',
      rule: '.connector-card:hover',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(248, 251, 255)' },
      paintOnly: true,
    },
  ],
});
