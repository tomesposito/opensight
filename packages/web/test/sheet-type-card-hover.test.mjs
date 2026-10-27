import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 45: hover feedback for the New Sheet dialog's
// sheet-type selection cards. Slice 44's behavioral dialog audit (real
// mouse hover + computed-style delta, Chromium) measured the enabled
// Interactive sheet card's label flat on hover — a clickable, bordered,
// padded selection card with a pointer cursor that changed nothing —
// while the same dialog's buttons, selects, inputs and textareas all
// tinted (slices 36/37/38/44). The enabled card now takes the author
// hover tint (#edf7f7), with the dark-chrome variant (#334c62) from
// slices 36/37/38/44. The disabled Pixel-Perfect card is excluded: it
// keeps its subtle resting background and not-allowed cursor.
// Background only, so resting geometry is identical; static (no
// animation), so no reduced-motion variant is needed.
const css = styles['style.css'];

const hoverRule = css.match(/\.sheet-type-card:hover:not\(\.sheet-type-card-disabled\)\s*\{([^}]*)\}/);
const darkRule = css.match(/\.author-workspace\[data-chrome=dark\]\s+\.sheet-type-card:hover:not\(\.sheet-type-card-disabled\)\s*\{([^}]*)\}/);

test('the sheet-type-card hover rules exist in light and dark chrome with the author tints', () => {
  assert.ok(hoverRule, 'expected the .sheet-type-card hover rule');
  assert.match(hoverRule[1], /background:\s*#edf7f7/);
  assert.ok(darkRule, 'expected the dark-chrome .sheet-type-card hover rule');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [hoverRule, darkRule]) {
    assert.ok(rule, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the resting card rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.sheet-type-card\s*\{([^}]*)\}/);
  assert.ok(resting, 'expected the .sheet-type-card resting rule');
  assert.match(resting[1], /padding:\s*10px 12px/);
  assert.match(resting[1], /border:\s*1px solid var\(--chrome-border, #c9d8de\)/);
  assert.match(resting[1], /cursor:\s*pointer/);
});

test('the disabled card keeps its flat resting state and is excluded from hover', () => {
  const disabled = css.match(/\.sheet-type-card-disabled\s*\{([^}]*)\}/);
  assert.ok(disabled, 'expected the .sheet-type-card-disabled resting rule');
  assert.match(disabled[1], /cursor:\s*not-allowed/);
  assert.match(disabled[1], /background:\s*var\(--chrome-subtle, #f2f6f8\)/);
  assert.ok(hoverRule, 'expected the hover rule to carry the disabled exclusion');
});

defineHoverCases('sheet-type-card hover', {
  html: `<div class="author-workspace"><dialog class="analysis-file-dialog analysis-settings-dialog" open><form><div class="sheet-type-cards"><label class="sheet-type-card" id="enabled"><input type="radio" checked><span><strong>Interactive sheet</strong></span></label><label class="sheet-type-card sheet-type-card-disabled" id="disabled"><input type="radio" disabled><span><strong>Pixel-Perfect report</strong></span></label></div></form></dialog></div>`,
  cases: [
    {
      target: '#enabled',
      rule: '.sheet-type-card:hover:not(.sheet-type-card-disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      excluded: [{ target: '#disabled', resting: { backgroundColor: 'rgb(242, 246, 248)' } }],
    },
  ],
});
