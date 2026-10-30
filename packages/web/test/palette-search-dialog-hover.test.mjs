import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 47: hover feedback for the command palette
// and global search dialogs. The two dialogs are CSS twins (identical
// --palette-* variables, identical dark headers) mounted at the
// app-shell level, so no workspace hover rule reaches them: their
// header Close buttons rested transparent, their search inputs rested
// flat white, and the global search type filter chips rested
// transparent — hovering any of them changed nothing while their list
// rows underlined. The Close buttons now take the dark-chrome hover
// tint (#2b3a55, the .toast / product-header language); the inputs and
// unpressed chips take the dialogs' own selected tint
// (var(--palette-selected)). The input rule sets background-color
// only, so the global search input's search-icon background image
// survives. All rules are paint-only, so resting geometry is
// identical; static (no animation), so no reduced-motion variant is
// needed.
const css = styles['style.css'];

const closeRule = css.match(/\.command-palette header button:hover, \.global-search header button:hover\s*\{([^}]*)\}/);
const inputRule = css.match(/\.command-palette input:hover:not\(:disabled\), \.global-search > input:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const chipRule = css.match(/\.global-search \.search-types button:hover:not\(\[aria-pressed=true\]\)\s*\{([^}]*)\}/);

test('the palette/search dialog hover rules exist with the dialog tints', () => {
  assert.ok(closeRule, 'expected the grouped header Close button hover rule');
  assert.match(closeRule[1], /background:\s*#2b3a55/);
  assert.ok(inputRule, 'expected the grouped search input hover rule');
  assert.match(inputRule[1], /background-color:\s*var\(--palette-selected\)/);
  assert.ok(chipRule, 'expected the search-types chip hover rule');
  assert.match(chipRule[1], /background:\s*var\(--palette-selected\)/);
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  for (const [name, rule] of [['close', closeRule], ['input', inputRule], ['chip', chipRule]]) {
    assert.ok(rule, `expected the ${name} hover rule`);
    assert.ok(!/padding|margin|border|width|height|font|box-shadow/.test(rule[1]), `${name} hover must change background only`);
  }
  assert.ok(!/background-image/.test(inputRule[1]), 'input hover must not touch the background image');
});

test('the resting rules still reserve the geometry the hover keeps', () => {
  const cpClose = css.match(/\.command-palette header button\s*\{([^}]*)\}/);
  assert.ok(cpClose, 'expected the command-palette resting header button rule');
  assert.match(cpClose[1], /background:\s*transparent/);
  const gsInput = css.match(/\.global-search > input\s*\{([^}]*)\}/);
  assert.ok(gsInput, 'expected the global-search resting input rule');
  assert.match(gsInput[1], /background:.*url\("data:image\/svg\+xml/);
  const chip = css.match(/\.global-search \.search-types button\s*\{([^}]*)\}/);
  assert.ok(chip, 'expected the resting search-types chip rule');
  assert.match(chip[1], /background:\s*transparent/);
  const pressed = css.match(/\.global-search \.search-types button\[aria-pressed=true\]\s*\{([^}]*)\}/);
  assert.ok(pressed, 'expected the pressed chip rule the hover excludes');
  assert.match(pressed[1], /background:\s*var\(--palette-selected\)/);
});

defineHoverCases('palette-search-dialog hover', {
  html: `
    <dialog class="command-palette" open>
      <header><h2>Command palette</h2><button type="button" id="cp-close">Close <span aria-hidden="true">×</span></button></header>
      <input id="cp-input" type="text" placeholder="Search commands…">
    </dialog>
    <dialog class="global-search" open>
      <header><h2>Search</h2><button type="button" id="gs-close">Close <span aria-hidden="true">×</span></button></header>
      <input id="gs-input" type="text" placeholder="Find anything">
      <div class="search-types" role="group"><span aria-hidden="true">Type</span>
        <button type="button" id="gs-chip" aria-pressed="false">☆ Favorites</button>
        <button type="button" id="gs-chip-pressed" aria-pressed="true">Analyses</button>
      </div>
    </dialog>`,
  cases: [
    {
      target: '#cp-close',
      rule: '.command-palette header button:hover, .global-search header button:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(43, 58, 85)' },
      paintOnly: true,
      unchanged: ['backgroundImage'],
    },
    {
      target: '#gs-close',
      rule: '.command-palette header button:hover, .global-search header button:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(43, 58, 85)' },
      paintOnly: true,
      unchanged: ['backgroundImage'],
    },
    {
      target: '#cp-input',
      rule: '.command-palette input:hover:not(:disabled), .global-search > input:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(217, 230, 250)' },
      paintOnly: true,
      unchanged: ['backgroundImage'],
    },
    {
      target: '#gs-input',
      rule: '.command-palette input:hover:not(:disabled), .global-search > input:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(217, 230, 250)' },
      paintOnly: true,
      unchanged: ['backgroundImage'],
    },
    {
      target: '#gs-chip',
      rule: '.global-search .search-types button:hover:not([aria-pressed="true"])',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(217, 230, 250)' },
      paintOnly: true,
      unchanged: ['backgroundImage'],
      excluded: ['#gs-chip-pressed'],
    },
  ],
});
