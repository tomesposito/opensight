import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 final audit: hover feedback for the bundle-import label
// (.author-workspace .bundle-import label in Author.tsx — the flex row
// "Import .qs or bundle JSON" wrapping the bundle file input). The
// exhaustive final audit (static extraction of every interactive
// element in packages/web/src, contexts resolved through the component
// graph, computed style at rest vs hover in Chromium with all five
// shipped stylesheets) found it was the author surface's last label
// with zero hover feedback: its sibling summary takes the author
// summary hover (.bundle-import summary:hover), the file input inside
// it is a native OS-rendered control (out of scope by design), and
// every other label :hover rule in the cascade is scoped elsewhere
// (property-section, parameter-editor, prep, data-dialog, sign-in,
// collection labels). The label now takes the author label tint
// #edf7f7 (dark #334c62) — the same tints as the property-section and
// parameter-editor label hovers — so the row reads as one surface with
// the field it labels. Background only, so resting geometry is
// identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const lightRule = styleCss.match(/^\.author-workspace \.bundle-import label:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.bundle-import label:hover\s*\{([^}]*)\}/m);

test('the bundle-import label hover rule exists with the author label tint, light and dark', () => {
  assert.ok(lightRule, 'expected the bundle-import label :hover rule');
  assert.match(lightRule[1], /background:\s*#edf7f7/);
  assert.ok(darkRule, 'expected the dark bundle-import label :hover rule');
  assert.match(darkRule[1], /background:\s*#334c62/);
});

test('the hover tint matches the neighbouring author label hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.property-section label:hover\s*\{[^}]*background:\s*#edf7f7/), 'the property-section label hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-workspace \.bundle-import summary:hover/), 'the bundle-import summary hover must remain');
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  for (const rule of [lightRule, darkRule]) {
    assert.ok(rule, 'expected both bundle-import label :hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
  }
});

test('the resting bundle-import rules are preserved', () => {
  assert.ok(styleCss.match(/\.bundle-import label\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/), 'the resting bundle-import label rule must remain');
  assert.ok(styleCss.match(/\.bundle-import\s*\{[^}]*border:\s*1px dashed/), 'the resting bundle-import box rule must remain');
});

describe('Bundle-import label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label background with identical geometry in the real ancestor context, light and dark, and labels outside .bundle-import are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="author-workspace" data-chrome="light"><div class="author-tools"><div class="bundle-import"><details open><summary>Import bundle</summary>`
      + `<label id="lightLabel">Import .qs or bundle JSON<input type="file"/></label></details></div>`
      + `<label id="outsideLabel">Outside<input/></label></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-tools"><div class="bundle-import"><details open><summary>Import bundle</summary>`
      + `<label id="darkLabel">Import .qs or bundle JSON<input type="file"/></label></details></div></div></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const light = all.find(r => norm(r) === '.author-workspace .bundle-import label:hover') ?? null;
      const dark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .bundle-import label:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        lightFound: !!light, darkFound: !!dark,
        lightProps: light ? [...light.style] : [], darkProps: dark ? [...dark.style] : [],
        lightLabel: light ? measure(el('lightLabel'), light) : null,
        darkLabel: dark ? measure(el('darkLabel'), dark) : null,
        outsideMatches: light ? el('outsideLabel').matches(light.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.equal(actual.lightFound, true, 'expected the light bundle-import label hover rule in the CSSOM');
    assert.equal(actual.darkFound, true, 'expected the dark bundle-import label hover rule in the CSSOM');
    assert.ok(actual.lightProps.every(p => p.startsWith('background')), 'light hover must set background longhands only');
    assert.ok(actual.darkProps.every(p => p.startsWith('background')), 'dark hover must set background longhands only');
    assert.equal(actual.lightLabel.rest.background, 'rgba(0, 0, 0, 0)', 'lightLabel rest');
    assert.equal(actual.lightLabel.hovered.background, 'rgb(237, 247, 247)', 'lightLabel hover');
    assert.equal(actual.lightLabel.rest.box, actual.lightLabel.hovered.box, 'lightLabel geometry');
    assert.equal(actual.darkLabel.hovered.background, 'rgb(51, 76, 98)', 'darkLabel hover');
    assert.equal(actual.darkLabel.rest.box, actual.darkLabel.hovered.box, 'darkLabel geometry');
    assert.equal(actual.outsideMatches, false, 'a label outside .bundle-import must be out of scope');
  });
});
