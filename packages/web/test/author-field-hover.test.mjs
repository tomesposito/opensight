import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 67: hover feedback for the author layout's
// plain fields (text/number/date inputs and textareas). The author
// hover rules cover buttons, selects (slice 36), color inputs (37) and
// search inputs (38), and the dialog-scoped rules cover their own
// dialogs, so a plain field in .author-layout — the Properties
// Title/Subtitle inputs, formatting numbers, parameter name/defaults,
// controls-strip text/date inputs, sheet rename, the sheet text
// object's editor — changed nothing on hover while the select beside
// it tinted. The fields now take the author buttons' hover tint
// (#edf7f7); dark chrome takes the dark button hover (#334c62). The
// rule is scoped to .author-layout so the header analysis-title input
// (transparent at rest, light text on the dark header, border-only
// hover by design) is never reached. Radio/checkbox/file/range are
// excluded: native/OS-rendered controls keep their own rendering (the
// house pattern, slice 38's by-design family). Background only, so
// resting geometry is identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const lightRule = styleCss.match(/\.author-layout\s+input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\):not\(\[type=range\]\),\s*\.author-layout\s+textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);
const darkRule = styleCss.match(/\.author-workspace\[data-chrome=dark\]\s+\.author-layout\s+input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\):not\(\[type=range\]\),\s*\.author-workspace\[data-chrome=dark\]\s+\.author-layout\s+textarea:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('author-layout plain inputs and textareas have a hover state with the author button tint', () => {
  assert.ok(lightRule, 'expected the .author-layout input/textarea hover rule');
  assert.match(lightRule[1], /background:\s*#edf7f7/);
});

test('dark chrome author-layout fields take the dark button hover tint', () => {
  assert.ok(darkRule, 'expected the dark .author-layout input/textarea hover rule');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the field hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [lightRule, darkRule]) {
    assert.ok(rule, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the neighbouring author hover rules are untouched', () => {
  assert.ok(styleCss.match(/\.author-workspace\s+select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'slice 36 select hover must remain');
  assert.ok(styleCss.match(/\.author-workspace\s+input\[type=color\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7; border-color:\s*#157f88/), 'slice 37 color hover must remain');
  assert.ok(styleCss.match(/\.author-workspace\s+input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'slice 38 search hover must remain');
});

test('the header analysis-title input keeps its border-only hover by design', () => {
  const title = styleCss.match(/\.author-workspace \.author-topbar \.analysis-title input:hover\s*\{([^}]*)\}/);
  assert.ok(title, 'expected the analysis-title hover rule');
  assert.match(title[1], /border-color:\s*var\(--header-border\)/);
  assert.ok(!/background/.test(title[1]), 'the title hover must stay border-only');
});

describe('author field hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${styleCss}</style>`
      + `<div class="author-workspace"><header class="author-topbar"><label class="analysis-title"><input id="title"></label></header>`
      + `<div class="author-layout"><label>Title <input id="text"></label>`
      + `<label>Size <input id="num" type="number"></label>`
      + `<label>Notes <textarea id="ta"></textarea></label>`
      + `<input id="off" disabled><input id="chk" type="checkbox"><input id="rng" type="range"></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout"><input id="dark-text"><textarea id="dark-ta"></textarea></div></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const light = all.find(r => (r.selectorText || '').includes('author-layout') && (r.selectorText || '').includes('textarea:hover') && !(r.selectorText || '').includes('data-chrome')) ?? null;
      const dark = all.find(r => (r.selectorText || '').includes('data-chrome') && (r.selectorText || '').includes('author-layout') && (r.selectorText || '').includes('textarea:hover')) ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const matches = (el, rule) => rule ? el.matches(rule.selectorText.replaceAll(':hover', '')) : null;
      return {
        lightFound: !!light, darkFound: !!dark,
        text: light ? measure(document.querySelector('#text'), light) : null,
        num: light ? measure(document.querySelector('#num'), light) : null,
        ta: light ? measure(document.querySelector('#ta'), light) : null,
        darkText: dark ? measure(document.querySelector('#dark-text'), dark) : null,
        darkTa: dark ? measure(document.querySelector('#dark-ta'), dark) : null,
        titleMatches: matches(document.querySelector('#title'), light),
        offMatches: matches(document.querySelector('#off'), light),
        chkMatches: matches(document.querySelector('#chk'), light),
        rngMatches: matches(document.querySelector('#rng'), light),
      };
    });
    assert.ok(actual.lightFound, 'expected the light hover rule in the CSSOM');
    assert.ok(actual.darkFound, 'expected the dark hover rule in the CSSOM');
    for (const key of ['text', 'num', 'ta']) {
      assert.equal(actual[key].rest.background, 'rgb(255, 255, 255)', `${key} rest`);
      assert.equal(actual[key].hovered.background, 'rgb(237, 247, 247)', `${key} hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} geometry`);
    }
    for (const key of ['darkText', 'darkTa']) {
      assert.equal(actual[key].hovered.background, 'rgb(51, 76, 98)', `${key} hover`);
      assert.equal(actual[key].rest.box, actual[key].hovered.box, `${key} geometry`);
    }
    assert.equal(actual.titleMatches, false, 'the header title input must be outside the rule scope');
    assert.equal(actual.offMatches, false, 'disabled fields must be excluded');
    assert.equal(actual.chkMatches, false, 'checkboxes must be excluded');
    assert.equal(actual.rngMatches, false, 'range inputs must be excluded');
  });
});
