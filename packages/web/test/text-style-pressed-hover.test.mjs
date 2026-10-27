import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 78: hover feedback for the sheet text
// object's pressed style toggles (.object-text-style
// button[aria-pressed="true"] in SheetObjectCard.tsx's
// SheetObjectProperties — Bold / Italic / Underline). The one rule
// that styles them pairs the pressed rest and hover in a single
// declaration at #166f7a, and its (0,4,1) hover variant beats the
// author generic hover (#edf7f7, (0,3,1)), so hovering a pressed
// toggle changed nothing, while every unpressed toggle steps
// transparent -> #edf7f7. The group only renders while a text sheet
// object is selected, so route audits never reach it. Following the
// slices 28/29/73-77 selected-control language, the pressed toggle
// now takes a dedicated hover step one visible step deeper than its
// #166f7a rest: #126e76, the app-wide primary hover step (slices
// 51/57/66), so no new color is introduced. Background only, so the
// white label is kept and resting geometry is identical; static
// (no animation), so no reduced-motion variant.
const css = styles['style.css'];

const rule = css.match(/\.author-layout \.object-text-style button\[aria-pressed="true"\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the pressed text-style toggle hover rule exists and uses the primary hover step', () => {
  assert.ok(rule, 'expected the .object-text-style button[aria-pressed="true"]:hover rule');
  assert.match(rule[1], /background:\s*#126e76/);
});

test('the hover tint is the established primary hover step, deeper than the pressed rest tint', () => {
  assert.ok(css.match(/\.author-workspace \.primary-button:hover:not\(:disabled\)\s*\{\s*background:\s*#126e76/), 'the primary-button hover step must remain #126e76');
  const pressed = css.match(/\.author-layout \.object-text-style button\[aria-pressed="true"\], \.author-layout \.object-text-style button\[aria-pressed="true"\]:hover\s*\{([^}]*)\}/);
  assert.ok(pressed, 'expected the paired pressed resting rule');
  assert.match(pressed[1], /background:\s*#166f7a/);
  assert.notEqual('#126e76', '#166f7a', 'the hover tint must differ from the resting tint');
});

test('the pressed-toggle hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting toggle rules are preserved', () => {
  const pressed = css.match(/\.author-layout \.object-text-style button\[aria-pressed="true"\], \.author-layout \.object-text-style button\[aria-pressed="true"\]:hover\s*\{([^}]*)\}/);
  assert.ok(pressed, 'expected the paired pressed resting rule');
  assert.match(pressed[1], /background:\s*#166f7a/);
  assert.match(pressed[1], /color:\s*white/);
  assert.ok(css.match(/\.object-text-style\s*\{\s*display:\s*flex/), 'the text-style group layout must remain');
});

test('the neighbouring author hover rules are untouched', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{\s*border-color:\s*#157f88;\s*background:\s*#edf7f7/), 'the author generic hover must remain #edf7f7');
  assert.ok(css.match(/\.author-workspace \.primary-button:hover:not\(:disabled\)\s*\{\s*background:\s*#126e76;\s*color:\s*white/), 'the author primary hover must remain');
});

defineHoverCases('text-style-pressed hover', {
  html: `<div class="author-layout">
      <div class="object-text-style" role="group" aria-label="Text style">
        <button type="button" id="pressed" aria-pressed="true">B</button>
        <button type="button" id="plain" aria-pressed="false">I</button>
      </div>
      <button type="button" id="outside" aria-pressed="true">X</button>
    </div>`,
  cases: [
    {
      target: '#pressed',
      rule: '.author-layout .object-text-style button[aria-pressed="true"]:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(22, 111, 122)' },
      hovered: { backgroundColor: 'rgb(18, 110, 118)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: [{ target: '#plain', resting: { backgroundColor: 'rgb(255, 255, 255)' } }, '#outside'],
    },
  ],
});
