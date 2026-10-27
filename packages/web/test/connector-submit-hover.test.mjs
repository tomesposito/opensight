import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 66: hover feedback for the connector setup
// submit button (.connector-submit in ConnectorDetails / DirectUpload
// — "Upload to staging", "Validate configuration", "Upload file").
// Static audit follow-on to slices 51/57/59: the submit is a primary
// button (style.css rests it #087cb8 with white text; app-chrome's
// app-shell override rests it #157f88) with no :hover rule of its own.
// A real-cascade Chromium probe (sign-in + data-section + style +
// app-chrome, real mouse hover) measured both of its contexts before
// the fix: in the standalone gallery section hovering changed nothing
// (#157f88 -> #157f88), and in its live context inside the
// create-dataset dialog (.data-dialog, CreateDatasetDialog's config
// stage) the generic data-dialog button rules reach it instead —
// their hover paints the light #eaf3f7 tint, and their resting color
// #176482 (specificity (0,1,1)) beats the button's own white from
// style.css ((0,1,0)), so the label rested dark teal on teal. The
// app-shell resting rule in app-chrome.css now also carries the white
// label ((0,2,0) beats the generic resting color; the disabled color
// (0,2,1) still wins while disabled), and the submit takes the
// app-wide primary hover step (#157f88 -> #126e76, slices 51/57/59).
// The .connector-details + button segments lift the hover rule to
// (0,5,1), tying the generic dialog hover (0,5,1) so app-chrome.css,
// loaded last, wins. Background only on hover, so resting geometry is
// identical. Static (no animation), so no reduced-motion variant is
// needed.
const css = styles['app-chrome.css'];
const styleCss = styles['style.css'];
const dataCss = styles['data-section.css'];

const submitHover = css.match(/\.app-shell \.connector-details button\.connector-submit:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the connector-submit hover rule exists with the primary hover step', () => {
  assert.ok(submitHover, 'expected the connector-submit hover rule');
  assert.match(submitHover[1], /background:\s*#126e76/);
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(submitHover, 'expected the connector-submit hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(submitHover[1]), 'hover must change background only');
});

test('the resting connector-submit rules are preserved and the app-shell rule carries the white label', () => {
  const shell = css.match(/\.app-shell \.connector-submit\s*\{([^}]*)\}/);
  assert.ok(shell, 'expected the app-shell connector-submit resting rule');
  assert.match(shell[1], /background:\s*#157f88/);
  assert.match(shell[1], /padding:\s*8px 12px/);
  assert.match(shell[1], /color:\s*#fff/);
  assert.ok(css.match(/\.app-shell \.connector-submit:disabled\s*\{[^}]*background:\s*#dbe3e9/), 'the app-shell disabled rule must still be present');
  const base = styleCss.match(/\.connector-submit\s*\{([^}]*)\}/);
  assert.ok(base, 'expected the style.css connector-submit resting rule');
  assert.match(base[1], /background:\s*#087cb8/);
  assert.match(base[1], /color:\s*white/);
});

test('the generic data-dialog rules the submit must outrank are untouched', () => {
  assert.ok(dataCss.match(/\.data-dialog button:hover:not\(:disabled\):not\(\.data-primary\):not\(\[aria-selected=true\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-dialog generic button hover rule (slice 30) must still be present');
  assert.ok(dataCss.match(/\.data-page button, \.data-dialog button\s*\{[^}]*color:\s*#176482/), 'the data-dialog generic button resting rule must still be present');
});

defineHoverCases('connector-submit hover', {
  html: `<div class="app-shell"><dialog class="data-dialog" open><div class="data-dialog-body"><aside class="connector-details"><form><button type="submit" class="connector-submit" id="dialog-submit">Upload to staging</button><button type="submit" class="connector-submit" id="dialog-off" disabled>Upload to staging</button></form></aside></div></dialog><main><section class="data-sources"><aside class="connector-details"><form><button type="submit" class="connector-submit" id="solo-submit">Validate configuration</button></form></aside></section></main></div>`,
  cases: [
    {
      target: '#dialog-submit',
      rule: '.app-shell .connector-details button.connector-submit:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(21, 127, 136)' },
      hovered: { backgroundColor: 'rgb(18, 110, 118)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: ['#dialog-off'],
    },
    {
      target: '#solo-submit',
      rule: '.app-shell .connector-details button.connector-submit:hover:not(:disabled)',
      resting: { backgroundColor: 'rgb(21, 127, 136)' },
      hovered: { backgroundColor: 'rgb(18, 110, 118)' },
      paintOnly: true,
      unchanged: ['color'],
    },
  ],
});
