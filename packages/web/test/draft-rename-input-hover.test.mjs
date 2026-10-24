import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 127: hover feedback for the draft-rename form's
// input (.draft-rename input in LocalDrafts.tsx, the rename field in the
// author sidebar's local-drafts panel). Slice 126's backup lead, re-verified
// this run: the input's collection-context instance already hovers via
// slice 64 (.collection-card input:hover, #eaf3f7), but in the author
// sidebar LocalDrafts renders inside .author-workspace > .author-tools >
// details.local-drafts — outside .collection-card and outside
// .author-layout (the author field hover's scope) — and the
// workspace-wide input hovers cover only color and search inputs, so the
// field matched no :hover rule in either author chrome while the label
// around it (slice 126), the panel summary and the form's buttons do step.
// A CSSOM probe with all five real stylesheets (1,397 rules) in the real
// ancestor contexts confirmed zero matching :hover rules for the input in
// both author contexts (rests rgb(255,255,255) light, rgb(32,46,64) dark),
// while the collection input matched the slice-64 rule alone. The input
// now takes the author surface's established field hover tints — #edf7f7
// light (the author-layout field hover and the rename-sheet input hover,
// the precedent for a rename input outside .author-layout) and #334c62 in
// dark chrome (the author dark field hover) — so no new colour is
// introduced. Both rules are scoped to .author-workspace, so the
// collection instance keeps its slice-64 hover untouched. Background
// only, so resting geometry is identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const appChromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const inputRule = styleCss.match(/^\.author-workspace \.draft-rename input:hover:not\(:disabled\)\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.draft-rename input:hover:not\(:disabled\)\s*\{([^}]*)\}/m);

test('the draft-rename input hover rules exist for the author sidebar and use the established author field tints', () => {
  assert.ok(inputRule, 'expected the author draft-rename input :hover rule');
  assert.match(inputRule[1], /background:\s*#edf7f7/);
  assert.ok(darkRule, 'expected the author dark-chrome draft-rename input hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the hover tints match the author field hovers, so no new colour is introduced, and the collection hover is preserved', () => {
  assert.ok(styleCss.match(/\.author-layout input:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#edf7f7/), 'the author-layout field hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.rename-sheet input:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the rename-sheet input hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.author-layout input:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#334c62/), 'the author-layout dark field hover must remain #334c62');
  assert.ok(appChromeCss.match(/\.collection-card input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection-card field hover must remain #eaf3f7');
});

test('the draft-rename input hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(inputRule, 'expected the author draft-rename input :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(inputRule[1]), 'hover must change background only');
  assert.ok(darkRule, 'expected the author dark-chrome draft-rename input hover variant');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(darkRule[1]), 'dark hover must change background only');
});

test('the resting draft-rename and local-drafts rules are preserved', () => {
  assert.ok(styleCss.match(/\.local-drafts form\s*\{[^}]*display:\s*flex/), 'the resting local-drafts form rule must remain');
  assert.ok(appChromeCss.match(/\.collection-card \.draft-rename label\s*\{[^}]*display:\s*grid[^}]*gap:\s*4px/), 'the resting collection draft-rename label rule must remain');
  assert.ok(appChromeCss.match(/\.draft-rename label:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the slice-126 draft-rename label hover must remain');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.draft-rename label:hover\s*\{[^}]*background:\s*#334c62/), 'the slice-126 dark label hover must remain');
});

describe('Draft-rename input hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the input visual state with identical geometry in the author light and dark contexts, the collection input keeps its slice-64 hover, and disabled and outside inputs are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="app-shell"><main><div class="analyses-home"><section class="collection-page"><div class="collection-card"><section class="local-drafts draft-collection"><form class="draft-rename"><label>Draft name<input id="collInput" value="Q3 sales"></label></form></section></div></section></div></main></div>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-tools"><details class="local-drafts" open><summary>Local drafts (1)</summary><form class="draft-rename"><label>Draft name<input id="authInput" value="Q3 sales"></label></form><form class="draft-rename"><label>Draft name<input id="disabledInput" value="Old" disabled></label></form></details></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-tools"><details class="local-drafts" open><summary>Local drafts (1)</summary><form class="draft-rename"><label>Draft name<input id="darkInput" value="Q3 sales"></label></form></details></div></div>`
      + `<div class="author-workspace" data-chrome="light"><form class="other-form"><label>Other name<input id="outsideInput" value="x"></label></form></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const light = all.find(r => norm(r) === '.author-workspace .draft-rename input:hover:not(:disabled)') ?? null;
      const dark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .draft-rename input:hover:not(:disabled)') ?? null;
      const coll = all.find(r => norm(r).startsWith('.collection-card input:hover')) ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        found: !!light,
        darkFound: !!dark,
        collFound: !!coll,
        props: light ? [...light.style] : [],
        darkProps: dark ? [...dark.style] : [],
        auth: light ? measure(el('authInput'), light) : null,
        darkInput: dark ? measure(el('darkInput'), dark) : null,
        collInput: coll ? measure(el('collInput'), coll) : null,
        collMatchesLight: light ? el('collInput').matches('.author-workspace .draft-rename input:not(:disabled)') : null,
        disabledMatches: el('disabledInput').matches('.author-workspace .draft-rename input:not(:disabled)'),
        outsideMatches: light ? el('outsideInput').matches('.author-workspace .draft-rename input:not(:disabled)') : null,
      };
    });
    assert.equal(actual.found, true, 'expected the author hover rule in the CSSOM');
    assert.equal(actual.darkFound, true, 'expected the dark-chrome hover rule in the CSSOM');
    assert.equal(actual.collFound, true, 'expected the slice-64 collection hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.ok(actual.darkProps.length && actual.darkProps.every(p => p.startsWith('background')), 'dark hover rule must set background longhands only');
    assert.equal(actual.auth.rest.background, 'rgb(255, 255, 255)', 'author light input rest');
    assert.equal(actual.auth.hovered.background, 'rgb(237, 247, 247)', 'author light input hover');
    assert.notEqual(actual.auth.rest.background, actual.auth.hovered.background);
    assert.equal(actual.auth.rest.color, actual.auth.hovered.color, 'author light input colour unchanged on hover');
    assert.equal(actual.auth.rest.box, actual.auth.hovered.box, 'author light input geometry');
    assert.equal(actual.darkInput.rest.background, 'rgb(32, 46, 64)', 'author dark input rest');
    assert.equal(actual.darkInput.hovered.background, 'rgb(51, 76, 98)', 'author dark input hover');
    assert.equal(actual.darkInput.rest.color, actual.darkInput.hovered.color, 'author dark input colour unchanged on hover');
    assert.equal(actual.darkInput.rest.box, actual.darkInput.hovered.box, 'author dark input geometry');
    assert.equal(actual.collInput.rest.background, 'rgb(255, 255, 255)', 'collection input rest');
    assert.equal(actual.collInput.hovered.background, 'rgb(234, 243, 247)', 'collection input keeps its slice-64 hover');
    assert.equal(actual.collMatchesLight, false, 'the collection input must be out of scope of the author rule');
    assert.equal(actual.disabledMatches, false, 'a disabled author input must be out of scope');
    assert.equal(actual.outsideMatches, false, 'an input outside .draft-rename must be out of scope');
  });
});
