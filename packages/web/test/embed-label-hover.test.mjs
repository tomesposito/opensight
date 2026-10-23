import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 111: hover feedback for the embed
// surfaces' field labels (.embed-question label — "Question" in
// embed-session-main.tsx; .embed-author label — "Analysis name",
// "Dataset", "Visual type", "Group by", "Value" and "Aggregation"
// in EmbeddedAuthor.tsx; and .embed-preview-controls label —
// "Branding" and "Palette" in embed-preview-main.tsx). The
// embed-question / embed-author label rule lays each label out as
// a column flex (text line, gap, field) and the preview-controls
// label is a flex row (text, gap, select), so each label has real
// visible area, but the labels had zero hover feedback: every
// label :hover rule in the cascade is scoped elsewhere (author
// toggles, parameter/action editor labels, the O-mode notice
// label, connector/sign-in/collection labels, the data-prep label
// series, the change-type label, the admin labels), so the labels
// rested transparent and hovering their text or gap changed
// nothing, while only the field inside each label tinted via the
// slice-54 embed field hover and the buttons beside them step
// via slice 53. A CSSOM probe with all five real stylesheets
// (1,370 rules) in the real ancestor contexts confirmed zero
// matching :hover rules for all three label types and a
// transparent rest for all of them, and confirmed the input
// inside the question label does match the slice-54 field hover.
// This was the fresh zero-hover audit on a new surface left by
// slice 110 (whose audit had already flagged the embed-author and
// embed-question labels as candidates). The labels now take
// #edf2fa, the embed surface's established hover tint
// (--embed-tint on .embed-frame and the slice-54 field hover), so
// no new colour is introduced — and because the inner field's own
// hover is the same tint, hovering the field inside the label
// reads as one surface, not two steps. Background only, so
// resting geometry is identical and there is no animation; the
// embed surfaces are fixed light, so no dark variant is added.
const embedCss = await readFile(new URL('../src/embed.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = embedCss.match(/\.embed-question label:hover,\.embed-author label:hover,\.embed-preview-controls label:hover\s*\{([^}]*)\}/);

test('the embed label hover rule exists for all three embed label contexts and uses the established hover tint', () => {
  assert.ok(rule, 'expected the grouped embed label :hover rule');
  assert.match(rule[1], /background:\s*#edf2fa/);
});

test('the hover tint matches the slice-54 embed field hover and the embed tint var, so no new colour is introduced', () => {
  assert.ok(embedCss.match(/\.embed-question input:hover:not\(:disabled\),\.embed-author input:hover:not\(:disabled\),\.embed-author select:hover:not\(:disabled\),\.embed-preview-controls select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf2fa/), 'the slice-54 embed field hover must remain #edf2fa');
  assert.ok(embedCss.match(/\.embed-frame\s*\{[^}]*--embed-tint:\s*#edf2fa/), 'the embed tint var must remain #edf2fa');
});

test('the embed label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting embed label rules are preserved and there is no dark variant', () => {
  assert.ok(embedCss.match(/\.embed-question label,\.embed-author label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*6px[^}]*margin:\s*12px 0/), 'the question/author label resting rule must remain');
  assert.ok(embedCss.match(/\.embed-preview-controls label\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*gap:\s*8px/), 'the preview-controls label resting rule must remain');
  assert.ok(!embedCss.match(/data-chrome=dark/), 'embed.css must have no dark-chrome variant');
});

describe('Embed label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry in the real ancestor contexts, and labels outside the embed label contexts are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="embed-frame"><section class="embed-question"><div role="search">`
      + `<label id="qLabel">Question<input value="x"/></label></div></section>`
      + `<section class="embed-author"><aside>`
      + `<label id="aLabel">Analysis name<input value="y"/></label>`
      + `<label id="aSelLabel">Dataset<select><option>s</option></select></label>`
      + `</aside></section><label id="frameLabel">Frame plain<input/></label></div>`
      + `<main class="embed-preview"><div class="embed-preview-controls">`
      + `<label id="pLabel">Branding<select><option>OpenSight default</option></select></label>`
      + `</div></main>`
      + `<label id="outsideLabel">Outside<input/></label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const found = all.find(r => norm(r) === '.embed-question label:hover, .embed-author label:hover, .embed-preview-controls label:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        q: found ? measure(el('qLabel'), found) : null,
        a: found ? measure(el('aLabel'), found) : null,
        aSel: found ? measure(el('aSelLabel'), found) : null,
        p: found ? measure(el('pLabel'), found) : null,
        frameMatches: found ? el('frameLabel').matches(found.selectorText.replaceAll(':hover', '')) : null,
        outsideMatches: found ? el('outsideLabel').matches(found.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    for (const key of ['q', 'a', 'aSel', 'p']) {
      assert.equal(actual[key].rest.background, 'rgba(0, 0, 0, 0)', `${key} label rest (transparent)`);
      assert.equal(actual[key].hovered.background, 'rgb(237, 242, 250)', `${key} label hover`);
      assert.notEqual(actual[key].rest.background, actual[key].hovered.background);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, `${key} label colour unchanged on hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} label geometry`);
    }
    assert.equal(actual.frameMatches, false, 'a plain label inside .embed-frame but outside the question/author contexts must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a label outside the embed surfaces must be out of scope');
  });
});
