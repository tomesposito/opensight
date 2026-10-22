import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 94: hover feedback for the gallery
// picker's connector toggle (label.connector-toggle in
// DataSources.tsx — "Show unavailable connectors", wrapping the
// showUnavailable checkbox in the .connector-picker of the
// standalone gallery). It had zero hover feedback. Every
// label/input :hover rule in the cascade is scoped elsewhere, and
// checkbox inputs are deliberately excluded from every field-hover
// rule so native controls keep their OS rendering — so neither
// the label nor its checkbox matched any :hover rule, while the
// gallery's search input (slice 90), cards and details controls do
// step. A CSSOM probe with all five real stylesheets (1,346 rules)
// in the real ancestor context confirmed zero matching :hover
// rules and a transparent rest for both the label and the
// checkbox. The label now takes the app surfaces' established
// hover tint (#eaf3f7 — the gallery's own search and details
// hovers, slices 90/91/93, and the data-connector-tile label hover
// in the Create Dataset dialog), so no new colour is introduced.
// The rule is on the label, not the checkbox: the checkbox keeps
// its native rendering, following the data-connector-tile
// precedent where the label surface hovers and its inner input
// does not. Background only, so resting geometry is identical and
// there is no animation. The gallery is a fixed-light app-shell
// surface, so no dark variant is added.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const dataCss = await readFile(new URL('../src/data-section.css', import.meta.url), 'utf8');

const rule = css.match(/^\.connector-toggle:hover\s*\{([^}]*)\}/m);

test('the connector-toggle hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .connector-toggle :hover rule');
  assert.match(rule[1], /background:\s*#eaf3f7/);
});

test('the hover tint matches the gallery search and details hovers and the connector-tile label hover, so no new colour is introduced', () => {
  assert.ok(css.match(/\.connector-search input\[type=search\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the connector-search hover must remain #eaf3f7');
  assert.ok(css.match(/\.connector-details input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\):not\(\[type=file\]\), \.connector-details select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eaf3f7/), 'the connector-details field hover must remain #eaf3f7');
  assert.ok(dataCss.match(/\.data-connector-tile:hover:not\(\[data-selected=true\]\)[^{]*\{[^}]*background:\s*#eaf3f7/), 'the data-connector-tile label hover must remain #eaf3f7');
});

test('the toggle hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting toggle rules are preserved and the checkbox has no hover rule of its own', () => {
  assert.ok(css.match(/\.connector-toggle\s*\{[^}]*display:\s*flex[^}]*cursor:\s*pointer/), 'the connector-toggle resting rule must remain');
  assert.ok(css.match(/\.connector-toggle input\s*\{[^}]*margin:\s*0/), 'the connector-toggle input resting rule must remain');
  assert.ok(!/\.connector-toggle input:hover/.test(css), 'the checkbox must keep its native rendering with no hover rule of its own');
  assert.ok(!/\.connector-toggle:hover[^{]*\{[^}]*input/.test(css), 'the toggle hover rule must not target the checkbox');
});

describe('Connector-toggle hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry, and the checkbox and outside labels are out of scope', async () => {
    await page.setContent(`<style>${css}</style>`
      + `<div class="app-shell"><main><section class="data-sources"><div class="connector-layout"><div class="connector-picker">`
      + `<label class="connector-toggle" id="toggleLabel"><input id="toggleBox" type="checkbox">Show unavailable connectors</label>`
      + `</div></div></section></main></div>`
      + `<label id="outsideLabel"><input type="checkbox">Other toggle</label>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const found = all.find(r => (r.selectorText || '') === '.connector-toggle:hover') ?? null;
      const label = document.querySelector('#toggleLabel');
      const box = document.querySelector('#toggleBox');
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const bare = found ? found.selectorText.replaceAll(':hover', '') : '';
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        label: found ? measure(label, found) : null,
        boxBackground: getComputedStyle(box).backgroundColor,
        boxMatches: found ? box.matches(bare) : null,
        outsideMatches: found ? document.querySelector('#outsideLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.label.rest.background, 'rgba(0, 0, 0, 0)', 'connector-toggle label rest (transparent)');
    assert.equal(actual.label.hovered.background, 'rgb(234, 243, 247)', 'connector-toggle label hover');
    assert.notEqual(actual.label.rest.background, actual.label.hovered.background);
    assert.equal(actual.label.rest.color, actual.label.hovered.color, 'connector-toggle label colour unchanged on hover');
    assert.equal(actual.label.rest.box, actual.label.hovered.box, 'connector-toggle label geometry');
    assert.equal(actual.boxMatches, false, 'the checkbox inside .connector-toggle must be out of scope');
    assert.equal(actual.outsideMatches, false, 'a label outside .connector-toggle must be out of scope');
  });
});
