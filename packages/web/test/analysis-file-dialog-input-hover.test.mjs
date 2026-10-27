import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 44: hover feedback for the analysis file
// dialogs' text inputs and textareas. Route audits never open a dialog,
// so these fields were never measured before: a behavioral audit that
// opens the New Sheet and Analysis Settings dialogs in Chromium (real
// mouse hover + computed-style delta) found the Sheet name input
// (430x28), the Analysis name input (430x28) and the Description
// textarea (430x64) measured white -> white, while the same dialogs'
// buttons and selects tinted via the author-workspace hover rules. The
// author input hover rules cover only [type=search] (slice 38) and
// [type=color] (slice 37); the dialogs' text inputs and textareas were
// the unfinished members. They now take the author buttons' hover tint
// (#edf7f7), with the dark-chrome variant (#334c62) from slices
// 36/37/38. Radio and checkbox inputs keep their native rendering.
// Background only, so resting geometry is identical; static (no
// animation), so no reduced-motion variant is needed.
const css = styles['style.css'];

const hoverRule = css.match(/\.analysis-file-dialog\s+input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\),\s*\.analysis-file-dialog\s+textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const darkRule = css.match(/\.author-workspace\[data-chrome=dark\]\s+\.analysis-file-dialog\s+input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\),\s*\.author-workspace\[data-chrome=dark\]\s+\.analysis-file-dialog\s+textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the dialog input/textarea hover rules exist in light and dark chrome with the author tints', () => {
  assert.ok(hoverRule, 'expected the .analysis-file-dialog input/textarea hover rule');
  assert.match(hoverRule[1], /background:\s*#edf7f7/);
  assert.ok(darkRule, 'expected the dark-chrome .analysis-file-dialog input/textarea hover rule');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [hoverRule, darkRule]) {
    assert.ok(rule, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the resting dialog input rule still reserves the geometry the hover keeps', () => {
  const resting = css.match(/\.analysis-file-dialog input \{([^}]*)\}/);
  assert.ok(resting, 'expected the .analysis-file-dialog input resting rule');
  assert.match(resting[1], /background:\s*var\(--chrome-surface, #fff\)/);
  assert.match(resting[1], /border:\s*1px solid var\(--chrome-border, #c9d8de\)/);
  assert.match(resting[1], /padding:\s*4px 8px/);
});

test('the dialog input/textarea hover coexists with the dialog button and select hovers', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\),\s*\.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author button hover rule must still be present');
  assert.ok(css.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-36 author select hover rule must still be present');
  assert.ok(css.match(/\.author-workspace input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the slice-38 author search-input hover rule must still be present');
});

defineHoverCases('analysis-file-dialog-input hover', {
  html: `<div class="author-workspace"><dialog class="analysis-file-dialog analysis-settings-dialog" open><form><label>Sheet name<input id="name" value="Sheet 2"></label><label>Description<textarea id="desc" rows="3">notes</textarea></label><label class="sheet-type-card"><input id="radio" type="radio" checked><span>Interactive sheet</span></label><label>Locked<input id="locked" disabled value="x"></label></form></dialog></div><input id="outside" value="outside">`,
  cases: [
    {
      target: '#name',
      rule: '.analysis-file-dialog input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]), .analysis-file-dialog textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#radio', '#locked', { target: '#outside', resting: { backgroundColor: 'rgb(255, 255, 255)' } }],
    },
    {
      target: '#desc',
      rule: '.analysis-file-dialog input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]), .analysis-file-dialog textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
