import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 94: hover feedback for the gallery
// picker's connector toggle (label.connector-toggle in
// DataSources.tsx — "Show unavailable connectors", wrapping the
// showUnavailable checkbox in the .connector-picker of the
// standalone gallery). It had zero hover feedback. Every
// label/input :hover rule in the cascade is scoped elsewhere, and
// checkbox inputs are deliberately excluded from every field-hover
// rule so native controls keep their OS rendering — so neither
// the label nor its checkbox matched any :hover rule, while the
// gallery's search input (slice 90), cards and details controls do
// step. A CSSOM probe with all five real stylesheets (1,346 rules)
// in the real ancestor context confirmed zero matching :hover
// rules and a transparent rest for both the label and the
// checkbox. The label now takes the app surfaces' established
// hover tint (#eaf3f7 — the gallery's own search and details
// hovers, slices 90/91/93, and the data-connector-tile label hover
// in the Create Dataset dialog), so no new colour is introduced.
// The rule is on the label, not the checkbox: the checkbox keeps
// its native rendering, following the data-connector-tile
// precedent where the label surface hovers and its inner input
// does not. Background only, so resting geometry is identical and
// there is no animation. The gallery is a fixed-light app-shell
// surface, so no dark variant is added.
const css = styles['style.css'];
const dataCss = styles['data-section.css'];

const rule = css.match(/^\.connector-toggle:hover\s*\{([^}]*)\}/m);

test('the connector-toggle hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .connector-toggle :hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the gallery search and details hovers and the connector-tile label hover, so no new colour is introduced', () => {
  assert.ok(css.match(/\.connector-search input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the connector-search hover must remain #eaf3f7');
  assert.ok(css.match(/\.connector-details input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\), \.connector-details select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the connector-details field hover must remain #eaf3f7');
  assert.ok(dataCss.match(/\.data-connector-tile:hover:not\(\[data-selected=true\]\)[^{]*\{[^}]*background:\s*#eaf3f7/), 'the data-connector-tile label hover must remain #eaf3f7');
});

test('the toggle hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting toggle rules are preserved and the checkbox has no hover rule of its own', () => {
  assert.ok(css.match(/\.connector-toggle\s*\{[^}]*display:\s*flex[^}]*cursor:\s*pointer/), 'the connector-toggle resting rule must remain');
  assert.ok(css.match(/\.connector-toggle input\s*\{[^}]*margin:\s*0/), 'the connector-toggle input resting rule must remain');
  assert.ok(!/\.connector-toggle input:hover/.test(css), 'the checkbox must keep its native rendering with no hover rule of its own');
  assert.ok(!/\.connector-toggle:hover[^{]*\{[^}]*input/.test(css), 'the toggle hover rule must not target the checkbox');
});

defineHoverCases('connector-toggle hover', {
  html: `<div class="app-shell"><main><section class="data-sources"><div class="connector-layout"><div class="connector-picker">`
      + `<label class="connector-toggle" id="toggleLabel"><input id="toggleBox" type="checkbox">Show unavailable connectors</label>`
      + `</div></div></section></main></div>`
      + `<label id="outsideLabel"><input type="checkbox">Other toggle</label>`,
  cases: [
    {
      target: '#toggleLabel',
      rule: '.connector-toggle:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(234, 243, 247)' },
      paintOnly: true,
      unchanged: ['color'],
      excluded: [{ target: '#toggleBox', resting: { backgroundColor: 'rgba(0, 0, 0, 0)' } }, '#outsideLabel'],
    },
  ],
});
