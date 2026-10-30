import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 114: hover feedback for the analysis
// file dialogs' field labels (.analysis-file-dialog label —
// "Analysis name" in SaveAnalysisCopy.tsx; "Analysis name",
// "Description" and "Analysis theme" in AnalysisSettings.tsx;
// "Sheet name", "Layout" and "Optimize for viewing on" in
// NewSheetDialog.tsx; "Row height (pixels)" and "Spacing between
// items (pixels)" in SheetLayoutSettings.tsx). The shared resting
// rule lays every dialog label out as a grid (text line, 4px gap,
// field), so each label is itself a visible surface, but the
// labels had zero hover feedback: every label :hover rule in the
// cascade is scoped elsewhere (author toggles, parameter/action
// editor labels, the O-mode notice label, connector/sign-in/
// collection labels, the data-prep label series, the change-type
// label, the admin labels, the embed labels, the sheet-controls
// labels), so the labels rested transparent and hovering their
// text or gap changed nothing, while only the field inside each
// label tinted via the slice-44 dialog field hover. A CSSOM probe
// with all five real stylesheets (1,374 rules) in the real
// ancestor contexts (author-workspace > dialog.analysis-file-
// dialog, light and dark chrome) confirmed zero matching :hover
// rules for the settings, theme, save-copy, sheet-name and
// dark-chrome layout labels and a transparent rest for all of
// them, and confirmed the input inside the settings label does
// match the slice-44 field hover. This was the fresh zero-hover
// audit on a new surface left by slice 113. The labels now take
// #eef3fd, the author surface's established hover tint (the
// slice-44 dialog field hover and the slice-45 sheet-type-card
// hover in this same dialog family), plus the author dark-chrome
// variant #36486a, so no new colour is introduced — and because
// the inner field's own hover is the same tint, hovering the
// field inside the label reads as one surface, not two steps.
// The New Sheet dialog's disabled sheet-type card keeps slice
// 45's exclusion: it is a label too, so the new rule excludes it
// by the same :not, leaving its subtle resting background and
// not-allowed cursor untouched (the enabled card's own slice-45
// hover already gives it the identical tint). Background only,
// so resting geometry is identical and there is no animation.
const styleCss = styles['style.css'];

const rule = styleCss.match(/^\.analysis-file-dialog label:hover:not\(\.sheet-type-card-disabled\)\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.analysis-file-dialog label:hover:not\(\.sheet-type-card-disabled\)\s*\{([^}]*)\}/m);

test('the file-dialog label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .analysis-file-dialog label :hover rule');
  assert.match(rule[1], /background:\s*#eef3fd/);
});

test('the hover tints match the slice-44 dialog field hover and the slice-45 sheet-type-card hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.analysis-file-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\), \.analysis-file-dialog textarea:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the slice-44 dialog field hover must remain #eef3fd');
  assert.ok(styleCss.match(/\.sheet-type-card:hover:not\(\.sheet-type-card-disabled\)\s*\{[^}]*background:\s*#eef3fd/), 'the slice-45 sheet-type-card hover must remain #eef3fd');
  assert.ok(darkRule, 'expected the author dark-chrome file-dialog label :hover variant');
  assert.match(darkRule[1], /background:\s*#36486a/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.analysis-file-dialog input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\)[^}]*\{[^}]*background:\s*#36486a/), 'the slice-44 dark dialog field hover must remain #36486a');
});

test('the file-dialog label hover rules are paint-only: resting geometry and label presentation cannot shift', () => {
  for (const r of [rule, darkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting dialog label rule is preserved and the disabled sheet-type card keeps its slice-45 exclusion', () => {
  assert.ok(styleCss.match(/\.analysis-file-dialog label\s*\{[^}]*display:\s*grid[^}]*gap:\s*4px/), 'the resting dialog label rule must remain');
  assert.ok(styleCss.match(/\.analysis-settings-dialog label\s*\{[^}]*margin-top:\s*12px/), 'the settings-dialog label spacing rule must remain');
  assert.ok(styleCss.match(/\.sheet-type-card-disabled\s*\{[^}]*cursor:\s*not-allowed[^}]*background:\s*var\(--chrome-subtle, #f2f6f8\)/), 'the disabled card resting rule must remain');
});

const dialog = (prefix, settings) => `<dialog class="analysis-file-dialog${settings ? ' analysis-settings-dialog' : ''}" open><form>`
      + `<label id="${prefix}Name">Analysis name<input value="x"></label>`
      + (settings ? `<label id="${prefix}Theme">Analysis theme<select><option>Light theme</option></select></label>` : '')
      + `</form></dialog>`;

defineHoverCases('file-dialog-label hover', {
  html: `<div class="author-workspace">${dialog('l', true)}`
      + `<dialog class="analysis-file-dialog" open><form><label id="lCopy">Analysis name<input value="y"></label></form></dialog>`
      + `<dialog class="analysis-file-dialog analysis-settings-dialog" open><form><div class="sheet-type-cards">`
      + `<label class="sheet-type-card" id="lCard"><input type="radio"><span><strong>Interactive sheet</strong></span></label>`
      + `<label class="sheet-type-card sheet-type-card-disabled" id="lDisabledCard"><input type="radio"><span><strong>Pixel-perfect</strong></span></label>`
      + `</div><label id="lSheet">Sheet name<input value="z"></label></form></dialog></div>`
      + `<div class="author-workspace" data-chrome="dark">${dialog('d', true)}</div>`
      + `<label id="outsideLabel">Outside<input></label>`,
  cases: [
    {
      target: '#lName',
      rule: '.analysis-file-dialog label:hover:not(.sheet-type-card-disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: [{ target: '#lDisabledCard', resting: { backgroundColor: 'rgb(242, 246, 248)' }, hovered: { backgroundColor: 'rgb(242, 246, 248)' } }, '#outsideLabel'],
    },
    {
      target: '#lCard',
      rule: '.analysis-file-dialog label:hover:not(.sheet-type-card-disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lTheme',
      rule: '.analysis-file-dialog label:hover:not(.sheet-type-card-disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lCopy',
      rule: '.analysis-file-dialog label:hover:not(.sheet-type-card-disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#lSheet',
      rule: '.analysis-file-dialog label:hover:not(.sheet-type-card-disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(238, 243, 253)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dName',
      rule: '.author-workspace[data-chrome="dark"] .analysis-file-dialog label:hover:not(.sheet-type-card-disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(54, 72, 106)' },
      paintOnly: true,
      unchanged: ['color'],
    },
    {
      target: '#dTheme',
      rule: '.author-workspace[data-chrome="dark"] .analysis-file-dialog label:hover:not(.sheet-type-card-disabled)',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(54, 72, 106)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
