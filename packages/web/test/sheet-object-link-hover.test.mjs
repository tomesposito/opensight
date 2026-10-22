import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

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
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

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

describe('Sheet-object link hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry, and links outside .sheet-object are out of scope', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-canvas"><div>`
      + `<section class="author-card sheet-object" aria-label="Text box 1">`
      + `<p class="field-hint">Link: <a id="target" href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a></p>`
      + `</section></div></div></div>`
      + `<section><a id="outside" href="#">Outside</a></section>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.sheet-object a:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, decoration: getComputedStyle(el).textDecorationLine, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, decoration: getComputedStyle(el).textDecorationLine, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const outside = document.querySelector('#outside');
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        target: found ? measure(document.querySelector('#target'), found) : null,
        outsideMatches: found ? outside.matches(found.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.target.rest.background, 'rgba(0, 0, 0, 0)', 'sheet-object link rest');
    assert.equal(actual.target.hovered.background, 'rgb(237, 247, 247)', 'sheet-object link hover');
    assert.notEqual(actual.target.rest.background, actual.target.hovered.background);
    assert.equal(actual.target.rest.color, 'rgb(0, 0, 238)', 'sheet-object link keeps the UA link colour at rest');
    assert.equal(actual.target.rest.color, actual.target.hovered.color, 'sheet-object link colour unchanged on hover');
    assert.equal(actual.target.rest.decoration, 'underline', 'sheet-object link keeps its underline at rest');
    assert.equal(actual.target.rest.decoration, actual.target.hovered.decoration, 'sheet-object link underline unchanged on hover');
    assert.equal(actual.target.rest.box, actual.target.hovered.box, 'sheet-object link geometry');
    assert.equal(actual.outsideMatches, false, 'a link outside .sheet-object must be out of scope');
  });
});
