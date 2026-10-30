import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 54: hover feedback for the embed surface
// fields (.embed-question / .embed-author input and select, and the
// .embed-preview-controls select). Slice 53 gave the embed buttons a
// hover step and noted the fields were left: embed.css carried no
// field :hover rules at all — the Question input, the embedded
// author's name input and its Dataset/Visual type/Group by/Value/
// Aggregation selects, and the preview's Branding/Palette selects all
// rest at #fff, but hovering changed nothing, while the buttons beside
// them tint. The fields now take #eef3fd on hover — the embed
// surface's own tint (--embed-tint on .embed-frame, the state-symbol
// background). Background only, so resting geometry is identical.
// Static (no animation), so no reduced-motion variant is needed.
// Disabled fields are excluded and keep their flat resting state.
const css = styles['embed.css'];

const hoverRule = css.match(/\.embed-question input:hover:not\(:disabled\),\.embed-author input:hover:not\(:disabled\),\.embed-author select:hover:not\(:disabled\),\.embed-preview-controls select:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the embed field hover rule exists for all four embed field contexts', () => {
  assert.ok(hoverRule, 'expected the grouped embed field hover rule');
  assert.match(hoverRule[1], /background:\s*#eef3fd/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule, 'expected the embed field hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(hoverRule[1]), 'hover must change background only');
});

test('the resting field rules still reserve the geometry the hover keeps', () => {
  const rest = css.match(/\.embed-question input,\.embed-author input,\.embed-author select\s*\{([^}]*)\}/);
  assert.ok(rest, 'expected the embed question/author field resting rule');
  assert.match(rest[1], /padding:\s*9px/);
  assert.match(rest[1], /border:\s*1px solid #bac6d3/);
  assert.match(rest[1], /background:\s*#fff/);
  const preview = css.match(/\.embed-preview-controls select\s*\{([^}]*)\}/);
  assert.ok(preview, 'expected the embed preview select resting rule');
  assert.match(preview[1], /border:\s*1px solid #b6c2d3/);
  assert.match(preview[1], /padding:\s*8px 28px 8px 12px/);
  assert.match(preview[1], /background:\s*#fff/);
});

test('the hover step coexists with the embed button hover rule and theme vars', () => {
  assert.ok(css.match(/\.embed-frame\s*\{[^}]*--embed-tint:\s*#eef3fd/), 'the embed tint var must still be present');
  assert.ok(css.match(/\.embed-state button:hover:not\(:disabled\),\.embed-question button:hover:not\(:disabled\),\.embed-author button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#d7e0ee/), 'the slice-53 embed button hover rule must still be present');
});

defineHoverCases('embed-field hover', {
  html: `<div class="embed-frame"><section class="embed-question">
      <label>Question<input id="q" type="text" value="total by region"></label>
    </section><section class="embed-author"><aside>
      <label>Dataset<select id="ds"><option>sales</option></select></label>
      <label>Locked<select id="locked" disabled><option>sales</option></select></label>
    </aside></section></div><main class="embed-preview"><div class="embed-preview-controls">
      <label>Branding<select id="brand"><option>OpenSight default</option></select></label>
    </div></main>`,
  cases: [
    {
      target: '#q',
      rule: '.embed-question input:hover:not(:disabled), .embed-author input:hover:not(:disabled), .embed-author select:hover:not(:disabled), .embed-preview-controls select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      excluded: ['#locked'],
    },
    {
      target: '#ds',
      rule: '.embed-question input:hover:not(:disabled), .embed-author input:hover:not(:disabled), .embed-author select:hover:not(:disabled), .embed-preview-controls select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
    {
      target: '#brand',
      rule: '.embed-question input:hover:not(:disabled), .embed-author input:hover:not(:disabled), .embed-author select:hover:not(:disabled), .embed-preview-controls select:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
    },
  ],
});
