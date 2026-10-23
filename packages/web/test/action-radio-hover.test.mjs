import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 101: hover feedback for the ActionEditor's
// radio labels (.action-radio-group label in ActionEditor.tsx — the
// Activation, Filter scope and Target visuals choices, all inside the
// .action-panel in the author Properties dock). They had zero hover
// feedback. Every :hover rule that reaches the panel is scoped
// elsewhere or excludes them — the author field hover reaches the
// panel's inputs and selects but deliberately excludes radio inputs
// so native controls keep their OS rendering, and no label hover rule
// reached .action-radio-group — so neither the labels nor their radios
// matched any :hover rule, while the fields and buttons around them
// do step. This is the radio variant of the slice-100 checkbox thread
// in the same panel, left as its backup lead. A CSSOM probe with all
// five real stylesheets in the real ancestor contexts (author light
// chrome and author dark chrome) confirmed zero matching :hover rules
// for the radio labels and a transparent rest in both. The labels now
// take #edf7f7, the author surface's established hover tint (the
// author button and field hovers), so no new colour is introduced.
// The rule is on the label, not the radio: the radio keeps its native
// rendering, following the slice-94 connector-toggle, slice-95
// sign-in-check, slice-96 favorites-filter, slice-97 toggle-label,
// slice-98 O-mode-label, slice-99 parameter-checkbox and slice-100
// action-checkbox precedents where the label surface hovers and its
// inner input does not. The :has(> input[type=radio]) scope — the
// slice-99/100 precedent — targets exactly the radio labels; the
// checkbox labels nested inside the same fieldsets (in
// .action-checkbox-list) stay out of scope because they are covered
// by slice 100. The dark-chrome variant takes the author dark hover
// tint (#334c62, the dark button and field hovers). Background only,
// so resting geometry is identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.action-radio-group label:has\(> input\[type=radio\]\):hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.action-radio-group label:has\(> input\[type=radio\]\):hover\s*\{([^}]*)\}/m);

test('the action radio label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .action-radio-group radio label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint matches the author button and field hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author button hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-layout input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\)/), 'the author field hover must remain and keep its radio exclusion');
});

test('the action radio label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting action-radio-group rules are preserved, the radio has no hover rule of its own, and the dark variant uses the author dark hover tint', () => {
  assert.ok(styleCss.match(/\.action-radio-group\s*\{[^}]*display:\s*grid/), 'the action-radio-group resting rule must remain');
  assert.ok(styleCss.match(/\.action-radio-group label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*row/), 'the action-radio-group label resting rule must remain');
  assert.ok(!/\.action-radio-group input:hover/.test(styleCss), 'the radio must keep its native rendering with no hover rule of its own');
  assert.ok(darkRule, 'expected the author dark-chrome action radio label hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark button hover must remain #334c62');
});

describe('Action radio label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the light and dark author contexts, and the radio, the checkbox labels and outside labels are out of scope', async () => {
    const panel = prefix => `<div class="action-panel"><div class="action-panel-body">`
      + `<fieldset class="action-radio-group"><legend>Activation</legend>`
      + `<label id="${prefix}Activation"><input id="${prefix}ActivationRadio" type="radio">Select</label></fieldset>`
      + `<fieldset class="action-radio-group"><legend>Filter scope</legend>`
      + `<label id="${prefix}Scope"><input type="radio">Selected fields</label>`
      + `<div class="action-checkbox-list"><label id="${prefix}Check"><input type="checkbox">region</label></div></fieldset>`
      + `<fieldset class="action-radio-group"><legend>Target visuals</legend>`
      + `<label id="${prefix}Target"><input type="radio">All visuals</label></fieldset>`
      + `</div></div>`;
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="author-workspace"><div class="author-layout"><aside class="builder-panel"><div class="panel-content">${panel('lt')}</div></aside></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout"><aside class="builder-panel"><div class="panel-content">${panel('dk')}</div></aside></div></div>`
      + `<label id="outsideLabel"><input type="radio">Other label</label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const found = all.find(r => norm(r) === '.action-radio-group label:has(> input[type=radio]):hover') ?? null;
      const darkFound = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .action-radio-group label:has(> input[type=radio]):hover') ?? null;
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
        activation: found ? measure(el('ltActivation'), found) : null,
        scope: found ? measure(el('ltScope'), found) : null,
        target: found ? measure(el('ltTarget'), found) : null,
        dark: darkFound ? measure(el('dkTarget'), darkFound) : null,
        radioMatches: found ? el('ltActivationRadio').matches(bare) : null,
        checkMatches: found ? el('ltCheck').matches(bare) : null,
        outsideMatches: found ? el('outsideLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.darkFound, 'expected the dark-chrome hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.ok(actual.darkProps.length && actual.darkProps.every(p => p.startsWith('background')), 'dark hover rule must set background longhands only');
    for (const [name, ctx] of [['activation', actual.activation], ['filter-scope', actual.scope], ['target-visuals', actual.target]]) {
      assert.equal(ctx.rest.background, 'rgba(0, 0, 0, 0)', `${name} label rest (transparent)`);
      assert.equal(ctx.hovered.background, 'rgb(237, 247, 247)', `${name} label hover`);
      assert.notEqual(ctx.rest.background, ctx.hovered.background);
      assert.equal(ctx.rest.color, ctx.hovered.color, `${name} label colour unchanged on hover`);
      assert.equal(ctx.rest.box, ctx.hovered.box, `${name} label geometry`);
    }
    assert.equal(actual.dark.rest.background, 'rgba(0, 0, 0, 0)', 'author dark target-visuals label rest (transparent)');
    assert.equal(actual.dark.hovered.background, 'rgb(51, 76, 98)', 'author dark target-visuals label hover');
    assert.equal(actual.dark.rest.color, actual.dark.hovered.color, 'author dark target-visuals label colour unchanged on hover');
    assert.equal(actual.dark.rest.box, actual.dark.hovered.box, 'author dark target-visuals label geometry');
    assert.equal(actual.radioMatches, false, 'the radio inside the label must be out of scope');
    assert.equal(actual.checkMatches, false, 'the checkbox labels nested in the same fieldset must be out of scope (slice 100 covers them)');
    assert.equal(actual.outsideMatches, false, 'a radio label outside .action-radio-group must be out of scope');
  });
});
