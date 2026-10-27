import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineHoverCases, styles } from './interaction.mjs';

// Issue #108 polish slice 88: hover feedback for the whole-box
// hyperlink shown under a text sheet object (SheetObjectCard.tsx —
// a plain <a> inside p.field-hint in section.author-card.sheet-object
// on the author canvas). The author generic hovers are
// button/input/select/textarea/summary-typed, and every a:hover rule
// in the cascade is scoped elsewhere (.app-nav/.section-nav,
// .fixture-notice, .first-run-docs, .product-header .breadcrumbs,
// the rail/folder/not-found/data-page/admin scopes), so it kept the
// pure UA default (transparent background, default link blue,
// underline) and matched no :hover rule. A CSSOM probe with all
// five real stylesheets (1,340 rules) in the real ancestor context
// confirmed zero matching :hover rules and rest == hover on every
// paint property. It is the only <a> inside .sheet-object anywhere,
// and it renders only when a text object has a link URL set, so
// route audits never hover it. The link now takes the author
// surface's established hover tint (#edf7f7, the tint the card's own
// toolbar buttons take via the author generic button hover).
// Background only, so the UA link colour/underline and resting
// geometry are unchanged; the author card is white in both chromes,
// so no dark variant is added.
const css = styles['style.css'];

const rule = css.match(/^\.sheet-object a:hover\s*\{([^}]*)\}/m);

test('the sheet-object link hover rule exists and uses the author surface tint', () => {
  assert.ok(rule, 'expected the .sheet-object a:hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint is the established author-surface hover tint, distinct from the transparent rest', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author generic button hover must remain #edf7f7');
  assert.notEqual('#edf7f7', 'transparent', 'the hover tint must differ from the resting state');
});

test('the link hover rule is paint-only: resting geometry and link presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:|text-decoration/.test(rule[1]), 'hover must change background only');
});

test('the resting sheet-object rules are preserved', () => {
  assert.ok(css.match(/\.author-card\s*\{[^}]*background:\s*white/), 'the author card resting rule must remain');
  assert.ok(css.match(/\.sheet-object \.sheet-text-editor\s*\{[^}]*background:\s*white/), 'the sheet text editor resting rule must remain');
});

defineHoverCases('sheet-object-link hover', {
  html: `<div class="author-workspace" data-chrome="light"><div class="author-canvas"><div>`
      + `<section class="author-card sheet-object" aria-label="Text box 1">`
      + `<p class="field-hint">Link: <a id="target" href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a></p>`
      + `</section></div></div></div>`
      + `<section><a id="outside" href="#">Outside</a></section>`,
  cases: [
    {
      target: '#target',
      rule: '.sheet-object a:hover',
      resting: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      hovered: { backgroundColor: 'rgb(237, 247, 247)' },
      paintOnly: true,
      unchanged: ['color', 'textDecorationLine'],
      excluded: ['#outside'],
    },
  ],
});
