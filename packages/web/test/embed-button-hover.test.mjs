import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 53: hover feedback for the embed surface
// buttons (.embed-state / .embed-question / .embed-author button).
// embed.css carried no :hover rules at all: the embed buttons rest at
// #eef3f8 with cursor:pointer, but hovering changed nothing, while
// every other surface in the app gives its buttons a hover step. The
// buttons now take #d7e0ee on hover — the codebase's existing
// blue-gray hover step (.fixture-notice a:hover in style.css).
// Background only, so resting geometry is identical. Static (no
// animation), so no reduced-motion variant is needed. Disabled
// buttons are excluded and keep their flat resting state.
const css = styles['embed.css'];

const hoverRule = css.match(/\.embed-state button:hover:not\(:disabled\),\.embed-question button:hover:not\(:disabled\),\.embed-author button:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the embed button hover rule exists for all three embed contexts', () => {
  assert.ok(hoverRule, 'expected the grouped embed button hover rule');
  assert.match(hoverRule[1], /background:\s*#d7e0ee/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the embed button hover rule');
  assert.ok(!/padding|margin|border|width|height|font-size|box-shadow/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting button rule still reserves the geometry the hover keeps', () => {
  const rest = css.match(/\.embed-state button,\.embed-question button,\.embed-author button\s*\{([^}]*)\}/);
  assert.ok(rest, 'expected the embed button resting rule');
  assert.match(rest[1], /padding:\s*9px 14px/);
  assert.match(rest[1], /border:\s*1px solid #bac6d3/);
  assert.match(rest[1], /cursor:\s*pointer/);
  assert.match(rest[1], /background:\s*#eef3f8/);
});

test('the hover step coexists with the embed theme vars and resting rules', () => {
  assert.ok(css.match(/\.embed-frame\s*\{[^}]*--embed-tint:\s*#eef3fd/), 'the embed tint var must still be present');
  assert.ok(css.match(/\.embed-question input,\.embed-author input,\.embed-author select\s*\{/), 'the embed field resting rule must still be present');
  assert.ok(css.match(/\.embed-preview-controls select\s*\{/), 'the embed preview select resting rule must still be present');
});

defineHoverCases('embed-button hover', {
  html: `<div class="embed-frame"><div class="embed-state">
      <button id="btn" type="button">Try again</button>
    </div></div>`,
  cases: [
    {
      target: '#btn',
      rule: '.embed-state button:hover:not(:disabled), .embed-question button:hover:not(:disabled), .embed-author button:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(238, 243, 248)' },
      hovered: { backgroundColor: 'rgb(215, 224, 238)' },
      paintOnly: true,
    },
  ],
});
