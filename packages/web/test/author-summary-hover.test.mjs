import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 42: hover feedback for the author workspace's
// disclosure summaries. A behavioral hover audit that included <summary>
// elements on the author route for the first time (real mouse hover,
// :hover and hit-test confirmed, Chromium, demo route) measured
// transparent -> transparent or white -> white on all ten author
// summaries: the builder-panel headers ("Data"/"Visuals"/"Properties"),
// the Data panel's field-group summaries ("Geography"/"Metadata"/
// "Sales"), "Parameters", the property-section summaries ("Analysis
// theme"), and the author-tools summaries ("Local drafts (1)",
// "Import bundle"). They already have the global pointer cursor, the
// focus outline and the slice-15 :active press; hover was the missing
// state. They now take the author buttons' hover tint (#edf7f7, slices
// 36/37/38 language); dark chrome takes the dark button hover
// background (#334c62) via a more specific variant. The header's
// .author-menu summary keeps its own header hover and is not in this
// group. Background only, so resting geometry is identical. Static
// (no animation), so no reduced-motion variant is needed.
const rawCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

const SELECTORS = [
  '.author-workspace .builder-panel > summary:hover',
  '.author-workspace .field-group > summary:hover',
  '.author-workspace .property-section > summary:hover',
  '.author-workspace .parameter-editor > summary:hover',
  '.author-workspace .local-drafts > summary:hover',
  '.author-workspace .bundle-import summary:hover',
];
const DARK_SELECTORS = SELECTORS.map(s => s.replace('.author-workspace ', '.author-workspace[data-chrome=dark] '));

function ruleFor(selectors) {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const list = m[1].split(',').map(s => s.trim());
    if (selectors.every(s => list.includes(s))) return m[2];
  }
  return null;
}
const hoverRule = ruleFor(SELECTORS);
const darkRule = ruleFor(DARK_SELECTORS);

test('the author summary hover rule exists for all six summary groups and uses the author tint', () => {
  assert.ok(hoverRule, 'expected the grouped author summary hover rule');
  assert.match(hoverRule, /background:\s*#edf7f7/);
});

test('the dark-chrome variant exists for all six groups and uses the dark hover background', () => {
  assert.ok(darkRule, 'expected the grouped dark author summary hover rule');
  assert.match(darkRule, /background:\s*#334c62/);
});

test('the hover rules are paint-only: resting geometry cannot shift', () => {
  assert.ok(hoverRule && darkRule, 'expected both author summary hover rules');
  for (const body of [hoverRule, darkRule]) {
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color/.test(body), 'hover must change background only');
  }
});

test('the resting author summary rules still reserve the geometry the hover keeps', () => {
  const panel = css.match(/\.builder-panel > summary \{([^}]*)\}/);
  assert.ok(panel, 'expected the .builder-panel > summary resting rule');
  assert.match(panel[1], /font-size:\s*13px/);
  const group = css.match(/\.field-group > summary \{([^}]*)\}/);
  assert.ok(group, 'expected the .field-group > summary resting rule');
  assert.match(group[1], /cursor:\s*pointer/);
  const section = css.match(/\.property-section summary \{([^}]*)\}/);
  assert.ok(section, 'expected the .property-section summary resting rule');
  assert.match(section[1], /cursor:\s*pointer/);
  const drafts = css.match(/\.local-drafts summary \{([^}]*)\}/);
  assert.ok(drafts, 'expected the .local-drafts summary resting rule');
  assert.match(drafts[1], /cursor:\s*pointer/);
});

test('the author summary hover rules coexist with the other summary states', () => {
  assert.ok(css.match(/\.author-menu summary:hover/), 'the author-menu summary keeps its own header hover rule');
  assert.ok(css.match(/\.card-footer\s+summary:hover/), 'the card-footer summary hover rule must still be present');
  assert.ok(css.match(/\.prep-execution\s+summary:hover/), 'the prep-execution summary hover rule must still be present');
  assert.ok(css.match(/summary:active\s*\{[^}]*transform:\s*translateY\(1px\)/), 'the global summary :active press must still be present');
  assert.ok(css.match(/summary:focus-visible/), 'the global summary focus-visible outline must still be present');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="author-workspace">
      <details class="builder-panel" open><summary id="panel">Data</summary></details>
      <details class="field-group" open><summary id="group">Geography</summary></details>
      <div class="bundle-import"><details><summary id="import">Import bundle</summary></details></div>
      <details><summary id="plain">Plain author summary</summary></details>
    </div><details><summary id="outside">Outside summary</summary></details>`);
    const actual = await page.evaluate(() => {
      const ours = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '').includes('.builder-panel > summary:hover') && !(rule.selectorText || '').includes('data-chrome')) ours.push(rule);
        }
      }
      const measure = el => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        for (const rule of ours) {
          const selectors = rule.selectorText.split(',').map(s => s.trim().replace(/:hover$/, ''));
          if (selectors.some(s => { try { return el.matches(s); } catch { return false; } })) {
            for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop));
          }
        }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        return { rest, hovered };
      };
      return {
        ruleCount: ours.length,
        props: ours.length ? [...ours[0].style] : [],
        backgroundColor: ours.length ? ours[0].style.getPropertyValue('background-color') : null,
        panel: measure(document.querySelector('#panel')),
        group: measure(document.querySelector('#group')),
        imp: measure(document.querySelector('#import')),
        plain: measure(document.querySelector('#plain')),
        outside: measure(document.querySelector('#outside')),
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(237, 247, 247)');
    for (const key of ['panel', 'group', 'imp']) {
      assert.equal(actual[key].hovered.background, 'rgb(237, 247, 247)', `${key} summary must tint on hover`);
      assert.equal(actual[key].rest.color, actual[key].hovered.color, 'text color must not change');
      assert.equal(actual[key].rest.box, actual[key].hovered.box, 'geometry must not change');
    }
    assert.equal(actual.panel.rest.background, 'rgb(255, 255, 255)');
    assert.equal(actual.group.rest.background, 'rgba(0, 0, 0, 0)');
    assert.equal(actual.plain.hovered.background, actual.plain.rest.background, 'summaries outside the six groups keep their own states');
    assert.equal(actual.outside.hovered.background, actual.outside.rest.background, 'summaries outside the author workspace keep their own states');
  });
}
