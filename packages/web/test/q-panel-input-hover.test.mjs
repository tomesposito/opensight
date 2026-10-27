import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 58: hover feedback for the Ask O side
// panel's search field (.q-side-panel .o-bar input — OEntry's "Ask a
// question" input, type=search, QSidePanel.tsx). Static audit
// follow-on to slices 53-57: the panel gives its buttons a hover step
// (.q-side-panel button:hover -> var(--chrome-menu-hover, #edf7f7))
// but the field had no hover rule of its own. Inside the Author
// workspace the generic author search-input hover reaches it, but on
// the Dashboard (QSidePanel renders there too, Dashboard.tsx) the
// panel is a fixed overlay outside .author-workspace, so hovering the
// field changed nothing while every button beside it tinted. The
// field now takes the panel's own hover tint — the same var its
// button rule uses (dark chrome resolves the var to #293f55,
// matching the buttons). At equal specificity to the author search
// hover rule and later in style.css, the panel input matches its
// panel buttons inside Author too. Background only, so resting
// geometry is identical. Static (no animation), so no reduced-motion
// variant is needed; disabled fields keep their flat resting state.
// The .o-bar scope keeps the mode notice's native checkbox (also
// inside the panel) on OS rendering by design.
const css = styles['style.css'];

const inputHover = css.match(/\.q-side-panel \.o-bar input:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the q-panel search input hover rule exists with the panel tint', () => {
  assert.ok(inputHover, 'expected the q-panel o-bar input hover rule');
  assert.match(inputHover[1], /background:\s*var\(--chrome-menu-hover, #edf7f7\)/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(inputHover, 'expected the q-panel input hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(inputHover[1]), 'hover must change background only');
});

test('the resting rules still reserve the geometry the hover keeps', () => {
  const field = css.match(/(?:^|\n)\.o-bar input\s*\{([^}]*)\}/);
  assert.ok(field, 'expected the o-bar input resting rule');
  assert.match(field[1], /padding:\s*8px/);
  assert.match(field[1], /border:\s*1px solid #c9d8de/);
  const panelField = css.match(/\.q-side-panel \.o-bar input\s*\{([^}]*)\}/);
  assert.ok(panelField, 'expected the q-panel o-bar input resting rule');
  assert.match(panelField[1], /flex:\s*1 1 0/);
});

test('the panel button hover and author search hover rules are untouched', () => {
  assert.ok(css.match(/\.q-side-panel button:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--chrome-menu-hover, #edf7f7\)/), 'the q-panel button hover rule must still be present');
  assert.ok(css.match(/\.author-workspace input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author search hover rule must still be present');
  assert.ok(css.indexOf('.q-side-panel .o-bar input:hover') > css.indexOf('.author-workspace input[type=search]:hover'), 'the panel input hover rule must stay later in the file so it wins at equal specificity inside Author');
});

defineHoverCases('q-panel-input hover', {
  html: `<div class="q-side-panel" role="dialog">
      <div class="q-panel-content"><section class="o-entry" aria-label="Ask a question">
      <form class="o-bar"><label for="q">Ask a question</label>
      <input id="q" type="search" value="Sum of revenue by region">
      <input id="off" type="search" disabled>
      <button type="submit">Ask</button></form>
      </section></div>
    </div>`,
  cases: [
    {
      target: '#q',
      rule: '.q-side-panel .o-bar input:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      excluded: ['#off'],
    },
  ],
});
