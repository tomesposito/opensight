import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 128: hover feedback for the dataset execution
// controls' labels (.execution-controls label in DatasetExecution.tsx —
// "Execution mode" wrapping the mode select in every context, plus
// "Refresh interval (minutes)" wrapping the interval input in the
// non-compact form). Backup lead from slice 124, carried through slices
// 125–127 and re-verified this run: every label :hover rule in the
// cascade is scoped elsewhere — the prep label hovers cover the
// document bar, columns, step editor, input config and staging scopes
// but not the execution details, the data-dialog label hover does not
// reach the data-detail page, and the author label hovers cover the
// parameter/property/rename panels but not the dataset header — so the
// labels rested transparent in all four real contexts (data-detail,
// data-prep, author light chrome, author dark chrome) and hovering
// their text or gap changed nothing, while the field inside each label
// tinted. A CSSOM probe with all five real stylesheets (1,399 rules) in
// the real ancestor contexts confirmed zero matching :hover rules and
// a transparent rest for every label, while the inner select matched
// the data-page / data-prep / author select hovers and the interval
// input matched the data-prep input hover. The resting rule
// (.execution-controls label { display: grid; gap: 5px; }) makes each
// label a visible surface (text line, gap, field). Each label now
// takes the hover tint of the field inside it on its own surface, so
// no new colour is introduced and label and field read as one surface:
// #eaf3f7 on the data surfaces (the data-page select hover), #edf6fc
// in data-prep (its select/input hovers), #edf7f7 in author light
// chrome and #334c62 in author dark chrome (the author select hovers).
// Background only, so resting geometry is identical and there is no
// animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const dataSectionCss = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const baseRule = styleCss.match(/^\.execution-controls label:hover\s*\{([^}]*)\}/m);
const prepRule = styleCss.match(/^\.data-prep \.execution-controls label:hover\s*\{([^}]*)\}/m);
const authorRule = styleCss.match(/^\.author-workspace \.execution-controls label:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.execution-controls label:hover\s*\{([^}]*)\}/m);

test('the execution-controls label hover rules exist for every surface and use each surface field tint', () => {
  assert.ok(baseRule, 'expected the base execution-controls label :hover rule');
  assert.match(baseRule[1], /background:\s*#eaf3f7/);
  assert.ok(prepRule, 'expected the data-prep execution-controls label hover variant');
  assert.match(prepRule[1], /background:\s*#edf6fc/);
  assert.ok(authorRule, 'expected the author execution-controls label hover variant');
  assert.match(authorRule[1], /background:\s*#edf7f7/);
  assert.ok(darkRule, 'expected the author dark-chrome execution-controls label hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the hover tints match the hovers of the fields inside the labels, so no new colour is introduced', () => {
  assert.ok(dataSectionCss.match(/\.data-page select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the data-page select hover must remain #eaf3f7');
  assert.ok(styleCss.match(/\.data-prep select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf6fc/), 'the data-prep select hover must remain #edf6fc');
  assert.ok(styleCss.match(/\.data-prep input:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*#edf6fc/), 'the data-prep input hover must remain #edf6fc');
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark select hover must remain #334c62');
});

test('the execution-controls label hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  for (const [name, rule] of [['base', baseRule], ['data-prep', prepRule], ['author', authorRule], ['dark', darkRule]]) {
    assert.ok(rule, `expected the ${name} execution-controls label :hover rule`);
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), `${name} hover must change background only`);
  }
});

test('the resting execution-controls rules are preserved', () => {
  assert.ok(styleCss.match(/\.execution-controls label\s*\{[^}]*display:\s*grid[^}]*gap:\s*5px/), 'the resting execution-controls label rule must remain');
  assert.ok(styleCss.match(/\.execution-controls input, \.execution-controls select\s*\{[^}]*padding:\s*7px 9px/), 'the resting execution-controls field rule must remain');
  assert.ok(styleCss.match(/\.prep-execution summary:hover\s*\{[^}]*background:\s*#edf6fc/), 'the prep-execution summary hover must remain');
});

describe('Execution-controls label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the data-detail, data-prep and author light/dark contexts, and labels outside .execution-controls are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="app-shell"><main><section class="data-page data-detail"><div class="data-summary"><aside class="data-summary-cards"><section class="data-card"><details open><summary>Storage settings</summary><section class="dataset-execution compact"><div class="execution-controls"><label id="ddLabel">Execution mode<select><option>DIRECT QUERY</option></select></label></div></section></details></section></aside></div></section></main></div>`
      + `<main><section class="data-prep"><details class="prep-execution" open><summary>Dataset execution</summary><section class="dataset-execution"><div class="execution-controls"><label id="prepModeLabel">Execution mode<select><option>DIRECT QUERY</option></select></label><form><label id="prepIntervalLabel">Refresh interval (minutes)<input type="number"></label></form></div></section></details></section></main>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-layout"><section class="dataset-header"><section class="dataset-execution compact"><div class="execution-controls"><label id="authLabel">Execution mode<select><option>DIRECT QUERY</option></select></label></div></section></section></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout"><section class="dataset-header"><section class="dataset-execution compact"><div class="execution-controls"><label id="darkLabel">Execution mode<select><option>DIRECT QUERY</option></select></label></div></section></section></div></div>`
      + `<main><section class="dataset-execution"><label id="outsideLabel">Other<select><option>x</option></select></label></section></main>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const find = selector => all.find(r => norm(r) === selector) ?? null;
      const base = find('.execution-controls label:hover');
      const prep = find('.data-prep .execution-controls label:hover');
      const author = find('.author-workspace .execution-controls label:hover');
      const dark = find('.author-workspace[data-chrome=dark] .execution-controls label:hover');
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      // The winning rule per context is the most specific matching one;
      // apply base first, then the surface variant, mirroring the cascade.
      const cascade = (id, ...rules) => {
        const target = el(id);
        const rest = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        for (const rule of rules) { if (rule) { for (const prop of rule.style) target.style.setProperty(prop, rule.style.getPropertyValue(prop)); } }
        const hovered = { background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, box: JSON.stringify(target.getBoundingClientRect().toJSON()) };
        target.removeAttribute('style');
        return { rest, hovered };
      };
      return {
        found: !!base, prepFound: !!prep, authorFound: !!author, darkFound: !!dark,
        props: base ? [...base.style] : [], prepProps: prep ? [...prep.style] : [],
        authorProps: author ? [...author.style] : [], darkProps: dark ? [...dark.style] : [],
        dd: base ? cascade('ddLabel', base) : null,
        prepMode: prep ? cascade('prepModeLabel', base, prep) : null,
        prepInterval: prep ? cascade('prepIntervalLabel', base, prep) : null,
        auth: author ? cascade('authLabel', base, author) : null,
        darkLabel: dark ? cascade('darkLabel', base, author, dark) : null,
        outsideMatches: base ? el('outsideLabel').matches('.execution-controls label') : null,
        single: base ? measure(el('ddLabel'), base) : null,
      };
    });
    assert.equal(actual.found, true, 'expected the base hover rule in the CSSOM');
    assert.equal(actual.prepFound, true, 'expected the data-prep hover rule in the CSSOM');
    assert.equal(actual.authorFound, true, 'expected the author hover rule in the CSSOM');
    assert.equal(actual.darkFound, true, 'expected the dark-chrome hover rule in the CSSOM');
    for (const [name, props] of [['base', actual.props], ['data-prep', actual.prepProps], ['author', actual.authorProps], ['dark', actual.darkProps]]) {
      assert.ok(props.length && props.every(p => p.startsWith('background')), `${name} hover rule must set background longhands only`);
    }
    const check = (name, m, hover) => {
      assert.equal(m.rest.background, 'rgba(0, 0, 0, 0)', `${name} label rest`);
      assert.equal(m.hovered.background, hover, `${name} label hover`);
      assert.notEqual(m.rest.background, m.hovered.background);
      assert.equal(m.rest.color, m.hovered.color, `${name} label colour unchanged on hover`);
      assert.equal(m.rest.box, m.hovered.box, `${name} label geometry`);
    };
    check('data-detail', actual.dd, 'rgb(234, 243, 247)');
    check('data-prep mode', actual.prepMode, 'rgb(237, 246, 252)');
    check('data-prep interval', actual.prepInterval, 'rgb(237, 246, 252)');
    check('author light', actual.auth, 'rgb(237, 247, 247)');
    check('author dark', actual.darkLabel, 'rgb(51, 76, 98)');
    assert.equal(actual.outsideMatches, false, 'a label outside .execution-controls must be out of scope');
  });
});
