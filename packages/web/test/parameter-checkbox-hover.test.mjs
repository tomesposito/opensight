import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 99: hover feedback for the ParameterEditor's
// plain checkbox labels (ParameterEditor.tsx — "Multiple values" and
// "Integer", plain <label> elements wrapping their checkbox inside the
// create-parameter form in details.parameter-editor, rendered in the
// author Data panel inside .author-layout). They had zero hover
// feedback. Every :hover rule that reaches the editor is scoped
// elsewhere or excludes them — the author field hover reaches the
// form's text input, select and textarea but deliberately excludes
// checkbox inputs so native controls keep their OS rendering, and the
// parameter-editor summary hover takes the details' direct-child
// summary only — so neither the labels nor their checkboxes matched
// any :hover rule, while the fields and buttons around them do step.
// A CSSOM probe with all five real stylesheets (1,354 rules) in the
// real ancestor contexts (author light chrome and author dark chrome)
// confirmed zero matching :hover rules for both labels and their
// checkboxes and a transparent rest in both, and confirmed the name,
// type and default fields do match the author field hovers. The
// labels now take #edf7f7, the author surface's established hover tint
// (the author button and field hovers), so no new colour is
// introduced. The rule is on the label, not the checkbox: the checkbox
// keeps its native rendering, following the slice-94 connector-toggle,
// slice-95 sign-in-check, slice-96 favorites-filter, slice-97
// toggle-label and slice-98 O-mode-label precedents where the label
// surface hovers and its inner input does not. The :has(>
// input[type=checkbox]) scope — the data-connector-tile's :has(>
// input:disabled) guard is the codebase precedent — targets exactly
// the two checkbox labels; the name, type and default-values field
// labels stay out of scope because their fields already hover via the
// author field hover. The dark-chrome variant takes the author dark
// hover tint (#334c62, the dark button and field hovers). Background
// only, so resting geometry is identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.parameter-editor label:has\(> input\[type=checkbox\]\):hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.parameter-editor label:has\(> input\[type=checkbox\]\):hover\s*\{([^}]*)\}/m);

test('the parameter checkbox label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .parameter-editor checkbox label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint matches the author button and field hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author button hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-layout input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\)/), 'the author field hover must remain and keep its checkbox exclusion');
});

test('the parameter checkbox label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting parameter-editor rules are preserved, the checkbox has no hover rule of its own, and the dark variant uses the author dark hover tint', () => {
  assert.ok(styleCss.match(/\.parameter-editor label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/), 'the parameter-editor label resting rule must remain');
  assert.ok(styleCss.match(/\.parameter-editor form\s*\{[^}]*padding:\s*8px 0/), 'the parameter-editor form resting rule must remain');
  assert.ok(!/\.parameter-editor input:hover/.test(styleCss), 'the checkbox must keep its native rendering with no hover rule of its own');
  assert.ok(darkRule, 'expected the author dark-chrome parameter checkbox label hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark button hover must remain #334c62');
});

describe('Parameter checkbox label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the light and dark author contexts, and the checkbox, the field labels and outside labels are out of scope', async () => {
    const editor = prefix => `<details class="parameter-editor" open><summary>Parameters</summary><form aria-label="Create parameter">`
      + `<label id="${prefix}NameLabel">Parameter name<input type="text"></label>`
      + `<label id="${prefix}Multi"><input id="${prefix}MultiBox" type="checkbox">Multiple values</label>`
      + `<label id="${prefix}Int"><input type="checkbox">Integer</label>`
      + `<label>Default values<textarea></textarea></label></form></details>`;
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="author-workspace"><div class="author-layout"><aside class="builder-panel"><div class="panel-content">${editor('lt')}</div></aside></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout"><aside class="builder-panel"><div class="panel-content">${editor('dk')}</div></aside></div></div>`
      + `<label id="outsideLabel"><input type="checkbox">Other label</label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const found = all.find(r => norm(r) === '.parameter-editor label:has(> input[type=checkbox]):hover') ?? null;
      const darkFound = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .parameter-editor label:has(> input[type=checkbox]):hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const bare = found ? found.selectorText.replaceAll(':hover', '') : '';
      const el = id => document.querySelector(`#${id}`);
      return {
        found: !!found,
        darkFound: !!darkFound,
        props: found ? [...found.style] : [],
        darkProps: darkFound ? [...darkFound.style] : [],
        multi: found ? measure(el('ltMulti'), found) : null,
        int: found ? measure(el('ltInt'), found) : null,
        dark: darkFound ? measure(el('dkMulti'), darkFound) : null,
        boxMatches: found ? el('ltMultiBox').matches(bare) : null,
        nameLabelMatches: found ? el('ltNameLabel').matches(bare) : null,
        outsideMatches: found ? el('outsideLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.darkFound, 'expected the dark-chrome hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.ok(actual.darkProps.length && actual.darkProps.every(p => p.startsWith('background')), 'dark hover rule must set background longhands only');
    for (const [name, ctx] of [['Multiple values', actual.multi], ['Integer', actual.int]]) {
      assert.equal(ctx.rest.background, 'rgba(0, 0, 0, 0)', `${name} label rest (transparent)`);
      assert.equal(ctx.hovered.background, 'rgb(237, 247, 247)', `${name} label hover`);
      assert.notEqual(ctx.rest.background, ctx.hovered.background);
      assert.equal(ctx.rest.color, ctx.hovered.color, `${name} label colour unchanged on hover`);
      assert.equal(ctx.rest.box, ctx.hovered.box, `${name} label geometry`);
    }
    assert.equal(actual.dark.rest.background, 'rgba(0, 0, 0, 0)', 'author dark checkbox label rest (transparent)');
    assert.equal(actual.dark.hovered.background, 'rgb(51, 76, 98)', 'author dark checkbox label hover');
    assert.equal(actual.dark.rest.color, actual.dark.hovered.color, 'author dark checkbox label colour unchanged on hover');
    assert.equal(actual.dark.rest.box, actual.dark.hovered.box, 'author dark checkbox label geometry');
    assert.equal(actual.boxMatches, false, 'the checkbox inside the label must be out of scope');
    assert.equal(actual.nameLabelMatches, false, 'the Parameter name field label must be out of scope (its field already hovers)');
    assert.equal(actual.outsideMatches, false, 'a checkbox label outside .parameter-editor must be out of scope');
  });
});
