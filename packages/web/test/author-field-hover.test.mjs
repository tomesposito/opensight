import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 67: hover feedback for the author layout's
// plain fields (text/number/date inputs and textareas). The author
// hover rules cover buttons, selects (slice 36), color inputs (37) and
// search inputs (38), and the dialog-scoped rules cover their own
// dialogs, so a plain field in .author-layout — the Properties
// Title/Subtitle inputs, formatting numbers, parameter name/defaults,
// controls-strip text/date inputs, sheet rename, the sheet text
// object's editor — changed nothing on hover while the select beside
// it tinted. The fields now take the author buttons' hover tint
// (#edf7f7); dark chrome takes the dark button hover (#334c62). The
// rule is scoped to .author-layout so the header analysis-title input
// (transparent at rest, light text on the dark header, border-only
// hover by design) is never reached. Radio/checkbox/file/range are
// excluded: native/OS-rendered controls keep their own rendering (the
// house pattern, slice 38's by-design family). Background only, so
// resting geometry is identical and there is no animation.
const styleCss = styles['style.css'];

const lightRule = styleCss.match(/\.author-layout\s+input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\):not\(\[type=range\]\),\s*\.author-layout\s+textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const darkRule = styleCss.match(/\.author-workspace\[data-chrome=dark\]\s+\.author-layout\s+input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\):not\(\[type=range\]\),\s*\.author-workspace\[data-chrome=dark\]\s+\.author-layout\s+textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('author-layout plain inputs and textareas have a hover state with the author button tint', () => {
  assert.ok(lightRule, 'expected the .author-layout input/textarea hover rule');
  assert.match(lightRule[1], /background:\s*#edf7f7/);
});

test('dark chrome author-layout fields take the dark button hover tint', () => {
  assert.ok(darkRule, 'expected the dark .author-layout input/textarea hover rule');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the field hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [lightRule, darkRule]) {
    assert.ok(rule, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the neighbouring author hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.author-workspace\s+select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'slice 36 select hover must remain');
  assert.ok(styleCss.match(/\.author-workspace\s+input\[type=color\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7; border-color:\s*#157f88/), 'slice 37 color hover must remain');
  assert.ok(styleCss.match(/\.author-workspace\s+input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'slice 38 search hover must remain');
});

test('the header analysis-title input keeps its border-only hover by design', () => {
  const title = styleCss.match(/\.author-workspace \.author-topbar \.analysis-title input:hover\s*\{([^}]*)\}/);
  assert.ok(title, 'expected the analysis-title hover rule');
  assert.match(title[1], /border-color:\s*var\(--header-border\)/);
  assert.ok(!/background/.test(title[1]), 'the title hover must stay border-only');
});

defineHoverCases('author-field hover', {
  html: `<div class="author-workspace"><header class="author-topbar"><label class="analysis-title"><input id="title"></label></header>`
      + `<div class="author-layout"><label>Title <input id="text"></label>`
      + `<label>Size <input id="num" type="number"></label>`
      + `<label>Notes <textarea id="ta"></textarea></label>`
      + `<input id="off" disabled><input id="chk" type="checkbox"><input id="rng" type="range"></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout"><input id="dark-text"><textarea id="dark-ta"></textarea></div></div>`,
  cases: [
    {
      target: '#text',
      rule: '.author-layout input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="range"]), .author-layout textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      excluded: ['#title', '#off', '#chk', '#rng'],
    },
    {
      target: '#num',
      rule: '.author-layout input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="range"]), .author-layout textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
    },
    {
      target: '#ta',
      rule: '.author-layout input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="range"]), .author-layout textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(255, 255, 255)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
    },
    {
      target: '#dark-text',
      rule: '.author-workspace[data-chrome="dark"] .author-layout input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="range"]), .author-workspace[data-chrome="dark"] .author-layout textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(32, 46, 64)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
    },
    {
      target: '#dark-ta',
      rule: '.author-workspace[data-chrome="dark"] .author-layout input:hover:not(:disabled):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="range"]), .author-workspace[data-chrome="dark"] .author-layout textarea:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(32, 46, 64)' },
      hovered: { backgroundColor: 'rgb(51, 76, 98)' },
      paintOnly: true,
    },
  ],
});
