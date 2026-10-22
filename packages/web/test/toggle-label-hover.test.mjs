import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 97: hover feedback for the Properties panels'
// toggle labels (label.toggle in Author.tsx / PropertiesSections.tsx /
// FormattingEditor.tsx / PivotOptionsEditor.tsx / TooltipEditor.tsx /
// SheetObjectCard.tsx — "Show legend", "Show totals", "Donut", "Hide
// empty rows", the filter-value labels, all inside .author-layout).
// They had zero hover feedback. Every :hover rule that reaches them is
// scoped elsewhere or excludes them — the author field hover
// deliberately excludes checkbox inputs so native controls keep their
// OS rendering, and the author button hover is button-typed — so
// neither the labels nor their checkboxes matched any :hover rule,
// while the buttons and fields around them do step. A CSSOM probe with
// all five real stylesheets (1,350 rules) in the real ancestor contexts
// (author light chrome and author dark chrome) confirmed zero matching
// :hover rules and a transparent rest in both. The label now takes
// #edf7f7, the author surface's established hover tint (the author
// button and field hovers), so no new colour is introduced. The rule is
// on the label, not the checkbox: the checkbox keeps its native
// rendering, following the slice-94 connector-toggle, slice-95
// sign-in-check and slice-96 favorites-filter precedents where the
// label surface hovers and its inner input does not. The selector is
// label.toggle, so the one div.toggle row in TooltipEditor (a span plus
// its Remove button, whose button already hovers via the author button
// hover) stays out of scope. The dark-chrome variant takes the author
// dark hover tint (#334c62, the dark button and field hovers).
// Background only, so resting geometry is identical and there is no
// animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^label\.toggle:hover\s*\{([^}]*)\}/m);
const darkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] label\.toggle:hover\s*\{([^}]*)\}/m);

test('the toggle label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the label.toggle :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint matches the author button and select hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author button hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
});

test('the toggle label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting toggle rules are preserved, the checkbox has no hover rule of its own, and the dark variant uses the author dark hover tint', () => {
  assert.ok(styleCss.match(/\.author-layout \.toggle\s*\{[^}]*flex-direction:\s*row[^}]*margin:\s*6px 0/), 'the toggle resting rule must remain');
  assert.ok(styleCss.match(/\.toggle input\s*\{[^}]*accent-color:\s*#157f88/), 'the toggle input resting rule must remain');
  assert.ok(!/label\.toggle input:hover/.test(styleCss), 'the checkbox must keep its native rendering with no hover rule of its own');
  assert.ok(!/label\.toggle:hover[^{]*\{[^}]*input/.test(styleCss), 'the label hover rule must not target the checkbox');
  assert.ok(darkRule, 'expected the author dark-chrome toggle label hover variant');
  assert.match(darkRule[1], /background:\s*#334c62/);
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark button hover must remain #334c62');
});

describe('Toggle label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the light and dark author contexts, and the checkbox, the div.toggle row and outside labels are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="author-workspace"><div class="author-layout"><aside class="builder-panel properties-panel"><div class="panel-content">`
      + `<label class="toggle" id="toggleLabel"><input id="toggleBox" type="checkbox">Show legend</label>`
      + `<div class="toggle" id="toggleDiv"><span>Extra field</span></div>`
      + `</div></aside></div></div>`
      + `<div class="author-workspace" data-chrome="dark"><div class="author-layout"><aside class="builder-panel properties-panel"><div class="panel-content">`
      + `<label class="toggle" id="toggleDark"><input type="checkbox">Show legend</label></div></aside></div></div>`
      + `<label id="outsideLabel"><input type="checkbox">Other toggle</label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === 'label.toggle:hover') ?? null;
      const darkFound = all.find(r => (r.selectorText || '').replaceAll('"', '') === '.author-workspace[data-chrome=dark] label.toggle:hover') ?? null;
      const label = document.querySelector('#toggleLabel');
      const darkLabel = document.querySelector('#toggleDark');
      const box = document.querySelector('#toggleBox');
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const bare = found ? found.selectorText.replaceAll(':hover', '') : '';
      const darkBare = darkFound ? darkFound.selectorText.replaceAll(':hover', '') : '';
      return {
        found: !!found,
        darkFound: !!darkFound,
        props: found ? [...found.style] : [],
        darkProps: darkFound ? [...darkFound.style] : [],
        label: found ? measure(label, found) : null,
        darkLabel: darkFound ? measure(darkLabel, darkFound) : null,
        boxMatches: found ? box.matches(bare) : null,
        divMatches: found ? document.querySelector('#toggleDiv').matches(bare) : null,
        darkBoxMatches: darkFound ? darkLabel.querySelector('input').matches(darkBare) : null,
        outsideMatches: found ? document.querySelector('#outsideLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.darkFound, 'expected the dark-chrome hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.ok(actual.darkProps.length && actual.darkProps.every(p => p.startsWith('background')), 'dark hover rule must set background longhands only');
    assert.equal(actual.label.rest.background, 'rgba(0, 0, 0, 0)', 'toggle label rest (transparent)');
    assert.equal(actual.label.hovered.background, 'rgb(237, 247, 247)', 'toggle label hover');
    assert.notEqual(actual.label.rest.background, actual.label.hovered.background);
    assert.equal(actual.label.rest.color, actual.label.hovered.color, 'toggle label colour unchanged on hover');
    assert.equal(actual.label.rest.box, actual.label.hovered.box, 'toggle label geometry');
    assert.equal(actual.darkLabel.rest.background, 'rgba(0, 0, 0, 0)', 'dark toggle label rest (transparent)');
    assert.equal(actual.darkLabel.hovered.background, 'rgb(51, 76, 98)', 'dark toggle label hover');
    assert.equal(actual.darkLabel.rest.color, actual.darkLabel.hovered.color, 'dark toggle label colour unchanged on hover');
    assert.equal(actual.darkLabel.rest.box, actual.darkLabel.hovered.box, 'dark toggle label geometry');
    assert.equal(actual.boxMatches, false, 'the checkbox inside label.toggle must be out of scope');
    assert.equal(actual.divMatches, false, 'the div.toggle row must be out of scope');
    assert.equal(actual.darkBoxMatches, false, 'the checkbox inside the dark label.toggle must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a label outside .toggle must be out of scope');
  });
});
