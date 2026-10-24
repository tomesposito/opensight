import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 126: hover feedback for the draft-rename form's
// label (.draft-rename label — "Draft name" in LocalDrafts.tsx, wrapping
// the rename input in the expanded drafts collection on the Analyses home
// page and again in the author sidebar's local-drafts panel). The label
// had zero hover feedback: slice 64 hovered the rename field inside it in
// the collection context and slices 96/124/125 hovered the neighbouring
// collection labels, but every other label :hover rule in the cascade is
// scoped elsewhere (author labels, calculation/analysis-file/data
// dialogs, prep labels, connector/sign-in labels, admin labels, embed
// labels, the collection tools/pagination labels), so the label rested
// transparent and hovering its text or gap changed nothing. A CSSOM probe
// with all five real stylesheets (1,395 rules) in the real ancestor
// contexts (app-shell > main > .analyses-home > section.collection-page >
// .collection-card > section.local-drafts.draft-collection >
// form.draft-rename > label, and the author sidebar's
// .author-workspace > .author-tools > details.local-drafts >
// form.draft-rename > label in light and dark chrome) confirmed zero
// matching :hover rules for the label and a transparent rest in all
// three, while the input inside it matched the slice-64 collection-card
// field hover in the collection context only. The label now takes
// #eaf3f7, the collection surface's established hover tint (the rename
// field inside it and the neighbouring labels), so no new colour is
// introduced — and because the label and the field inside it take the
// same tint in the collection context, hovering either reads as one
// surface, not two steps. The same light rule reaches the author sidebar
// in light chrome, following the slice-96 favorites-filter precedent for
// this same component; the author dark-chrome variant takes the author
// dark hover tint #334c62. Background only, so resting geometry is
// identical and there is no animation.
const appChromeCss = await readFile(new URL('../src/app-chrome.css', import.meta.url), 'utf8');
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = appChromeCss.match(/^\.draft-rename label:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.draft-rename label:hover\s*\{([^}]*)\}/m);

test('the draft-rename label hover rule exists and uses the established hover tint', () => {
  assert.ok(labelRule, 'expected the draft-rename label :hover rule');
  assert.match(labelRule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the collection field and neighbouring label hovers, so no new colour is introduced', () => {
  assert.ok(appChromeCss.match(/\.collection-card input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection-card field hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.favorites-filter:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the favorites-filter label hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.draft-collection-tools label:hover:not\(\.favorites-filter\)\s*\{[^}]*background:\s*#eaf3f7/), 'the collection search label hover must remain #eaf3f7');
  assert.ok(appChromeCss.match(/\.collection-pagination label:hover\s*\{[^}]*background:\s*#eaf3f7/), 'the collection pagination label hover must remain #eaf3f7');
});

test('the draft-rename label hover rule is paint-only: resting geometry and presentation cannot shift', () => {
  assert.ok(labelRule, 'expected the draft-rename label :hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(labelRule[1]), 'hover must change background only');
  assert.ok(darkRule, 'expected the author dark-chrome draft-rename label hover variant');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(darkRule[1]), 'dark hover must change background only');
});

test('the resting draft-rename rules are preserved and the dark variant uses the author dark hover tint', () => {
  assert.ok(appChromeCss.match(/\.collection-card \.draft-rename\s*\{[^}]*border-top:\s*1px solid #d1e0e5/), 'the resting collection draft-rename rule must remain');
  assert.ok(appChromeCss.match(/\.collection-card \.draft-rename label\s*\{[^}]*display:\s*grid[^}]*gap:\s*4px/), 'the resting collection draft-rename label rule must remain');
  assert.ok(styleCss.match(/\.local-drafts form\s*\{[^}]*display:\s*flex/), 'the resting local-drafts form rule must remain');
  assert.ok(darkRule, 'expected the author dark-chrome draft-rename label hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] \.favorites-filter:hover\s*\{[^}]*background:\s*#334c62/), 'the favorites-filter dark hover must remain #334c62');
});

describe('Draft-rename label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the collection, author light and author dark contexts, and the input and outside labels are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="app-shell"><main><div class="analyses-home"><section class="collection-page"><div class="collection-card"><section class="local-drafts draft-collection"><form class="draft-rename"><label id="collLabel">Draft name<input id="collInput" value="Q3 sales"></label><button type="submit">Save draft name</button></form></section></div></section></div></main></div>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-tools"><details class="local-drafts" open><summary>Local drafts (1)</summary><form class="draft-rename"><label id="authLabel">Draft name<input value="Q3 sales"></label></form></details></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-tools"><details class="local-drafts" open><summary>Local drafts (1)</summary><form class="draft-rename"><label id="darkLabel">Draft name<input value="Q3 sales"></label></form></details></div></div>`
      + `<form class="other-form"><label id="outsideLabel">Other name<input value="x"></label></form>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const label = all.find(r => norm(r) === '.draft-rename label:hover') ?? null;
      const dark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .draft-rename label:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      const bare = label ? label.selectorText.replaceAll(':hover', '') : '';
      return {
        found: !!label,
        darkFound: !!dark,
        props: label ? [...label.style] : [],
        darkProps: dark ? [...dark.style] : [],
        coll: label ? measure(el('collLabel'), label) : null,
        auth: label ? measure(el('authLabel'), label) : null,
        darkLabel: dark ? measure(el('darkLabel'), dark) : null,
        inputMatches: label ? el('collInput').matches(bare) : null,
        outsideMatches: label ? el('outsideLabel').matches(bare) : null,
      };
    });
    assert.equal(actual.found, true, 'expected the hover rule in the CSSOM');
    assert.equal(actual.darkFound, true, 'expected the dark-chrome hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.ok(actual.darkProps.length && actual.darkProps.every(p => p.startsWith('background')), 'dark hover rule must set background longhands only');
    assert.equal(actual.coll.rest.background, 'rgba(0, 0, 0, 0)', 'collection label rest');
    assert.equal(actual.coll.hovered.background, 'rgb(234, 243, 247)', 'collection label hover');
    assert.notEqual(actual.coll.rest.background, actual.coll.hovered.background);
    assert.equal(actual.coll.rest.color, actual.coll.hovered.color, 'collection label colour unchanged on hover');
    assert.equal(actual.coll.rest.box, actual.coll.hovered.box, 'collection label geometry');
    assert.equal(actual.auth.rest.background, 'rgba(0, 0, 0, 0)', 'author light label rest');
    assert.equal(actual.auth.hovered.background, 'rgb(234, 243, 247)', 'author light label hover');
    assert.equal(actual.auth.rest.color, actual.auth.hovered.color, 'author light label colour unchanged on hover');
    assert.equal(actual.auth.rest.box, actual.auth.hovered.box, 'author light label geometry');
    assert.equal(actual.darkLabel.rest.background, 'rgba(0, 0, 0, 0)', 'author dark label rest');
    assert.equal(actual.darkLabel.hovered.background, 'rgb(51, 76, 98)', 'author dark label hover');
    assert.equal(actual.darkLabel.rest.color, actual.darkLabel.hovered.color, 'author dark label colour unchanged on hover');
    assert.equal(actual.darkLabel.rest.box, actual.darkLabel.hovered.box, 'author dark label geometry');
    assert.equal(actual.inputMatches, false, 'the input inside the label must be out of scope of the label rule');
    assert.equal(actual.outsideMatches, false, 'a label outside .draft-rename must be out of scope');
  });
});
