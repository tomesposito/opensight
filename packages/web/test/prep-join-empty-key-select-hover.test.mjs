import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 final audit: hover feedback for the empty join
// key-column select (.data-prep .prep-key-column.empty select — the
// dashed placeholder dropdown in PrepJoinEditor.tsx, where the next
// join key is picked). The exhaustive final audit (static extraction
// of every interactive element in packages/web/src, contexts resolved
// through the component graph, computed style at rest vs hover in
// Chromium with all five shipped stylesheets) found it was a
// rule-but-no-change surface: .data-prep select:hover (#edf6fc)
// matches it, but ties the empty resting rule (.prep-key-column.empty
// select, white) on specificity — 0-3-1 each once :not(:disabled) is
// counted — and loses on source order, so hovering the empty select
// changed nothing. The non-empty key select (resting #f5fbff at
// 0-2-1) hovers correctly, and the label wrapping both takes the
// slice-104 key-column label hover. The empty select — a live
// dropdown, not a disabled state — now takes the same prep tint
// #edf6fc on hover, so no new colour is introduced. Background only,
// so resting geometry is identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const emptyHover = styleCss.match(/^\.data-prep \.prep-key-column\.empty select:hover:not\(:disabled\)\s*\{([^}]*)\}/m);

test('the empty key-column select hover rule exists with the prep tint', () => {
  assert.ok(emptyHover, 'expected the empty key-column select :hover rule');
  assert.match(emptyHover[1], /background:\s*#edf6fc/);
});

test('the hover tint matches the general prep select hover, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the general prep select hover must remain #edf6fc');
});

test('the hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(emptyHover, 'expected the empty key-column select :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(emptyHover[1]), 'hover must change background only');
});

test('the resting key-column select rules are preserved', () => {
  assert.ok(styleCss.match(/\.data-prep \.prep-key-column\.empty select\s*\{[^}]*border-style:\s*dashed[^}]*background:\s*#fff/), 'the empty key select resting rule must remain');
  assert.ok(styleCss.match(/\.data-prep \.prep-key-column select\s*\{[^}]*background:\s*#f5fbff/), 'the non-empty key select resting rule must remain');
});

describe('Empty join key-column select hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule tints the empty select with identical geometry, and the non-empty select keeps its own hover path', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="data-prep"><div class="prep-join-editor"><div class="prep-join-keys">`
      + `<label class="prep-key-column empty"><select id="emptySelect"><option>Choose a column</option></select></label>`
      + `<label class="prep-key-column"><select id="filledSelect"><option>region</option></select></label>`
      + `</div></div></div>`
      + `<div class="data-prep"><label class="prep-key-column empty"><select id="disabledSelect" disabled><option>Choose a column</option></select></label></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const rule = all.find(r => norm(r) === '.data-prep .prep-key-column.empty select:hover:not(:disabled)') ?? null;
      const general = all.find(r => norm(r) === '.data-prep select:hover:not(:disabled)') ?? null;
      const measure = (el, r) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (r) { for (const prop of r.style) el.style.setProperty(prop, r.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        found: !!rule, props: rule ? [...rule.style] : [],
        empty: rule ? measure(el('emptySelect'), rule) : null,
        filled: general ? measure(el('filledSelect'), general) : null,
        disabledMatches: rule ? el('disabledSelect').matches(rule.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.equal(actual.found, true, 'expected the empty key-column select hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.empty.rest.background, 'rgb(255, 255, 255)', 'emptySelect rest');
    assert.equal(actual.empty.hovered.background, 'rgb(237, 246, 252)', 'emptySelect hover');
    assert.equal(actual.empty.rest.box, actual.empty.hovered.box, 'emptySelect geometry');
    assert.equal(actual.filled.rest.background, 'rgb(245, 251, 255)', 'filledSelect rest');
    assert.equal(actual.filled.hovered.background, 'rgb(237, 246, 252)', 'filledSelect keeps its hover');
    assert.equal(actual.disabledMatches, false, 'a disabled empty key select must stay flat');
  });
});
