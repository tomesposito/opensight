import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 79: hover feedback for the author menu's
// OPEN summary (.author-menu details[open] > summary in
// AuthorMenuItem.tsx — File / Edit / Data / Insert / Sheets /
// Objects). The resting rule groups details[open] with :active at
// var(--header-pressed) (#0b435f, specificity (0,2,2) for the open
// variant), which beats the only hover rule (.author-menu
// summary:hover, var(--header-hover), (0,2,1)), so hovering an open
// menu's summary changed nothing, while every closed summary steps
// transparent -> var(--header-hover). Every menu renders closed by
// default (the exclusive name="analysis-menu" disclosure group), so
// route audits only ever hover the closed state — the slices
// 50/62/64/67/68 blind spot; slice 42 waved this control off as
// having "its own header hover", true only when closed. The open
// summary now takes var(--header-hover) (#126080) on hover: the
// closed summary's own hover colour and the in-bar precedent for a
// control resting at var(--header-pressed) (the Ask O bar button
// rests var(--header-pressed) -> hovers var(--header-hover)), so no
// new colour is introduced. Background only, so the open rule's
// inset focus shadow is kept and resting geometry is identical;
// static (no animation), so no reduced-motion variant.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const rule = css.match(/\.author-menu details\[open\] > summary:hover\s*\{([^}]*)\}/);

test('the open author-menu summary hover rule exists and uses the header hover colour', () => {
  assert.ok(rule, 'expected the .author-menu details[open] > summary:hover rule');
  assert.match(rule[1], /background:\s*var\(--header-hover\)/);
});

test('the hover colour is the existing --header-hover var, distinct from the --header-pressed rest', () => {
  assert.ok(css.match(/--header-hover:\s*#126080/), 'the --header-hover var must remain #126080');
  assert.ok(css.match(/--header-pressed:\s*#0b435f/), 'the --header-pressed var must remain #0b435f');
  assert.notEqual('#126080', '#0b435f', 'the hover colour must differ from the resting colour');
  assert.ok(css.match(/\.author-workspace \.author-menu \.o-bar button\s*\{[^}]*background:\s*var\(--header-pressed\)/), 'the Ask O bar button must still rest at var(--header-pressed)');
  assert.ok(css.match(/\.author-workspace \.author-menu \.o-bar button:hover:not\(:disabled\)\s*\{\s*background:\s*var\(--header-hover\)/), 'the Ask O bar button precedent hover must remain var(--header-hover)');
});

test('the open-summary hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting author-menu summary rules are preserved', () => {
  const open = css.match(/\.author-menu summary:active, \.author-menu details\[open\] > summary\s*\{([^}]*)\}/);
  assert.ok(open, 'expected the paired :active / details[open] resting rule');
  assert.match(open[1], /background:\s*var\(--header-pressed\)/);
  assert.match(open[1], /box-shadow:\s*inset 0 -3px var\(--header-focus\)/);
  assert.ok(css.match(/\.author-menu summary:hover, \.author-menu summary:focus-visible\s*\{\s*background:\s*var\(--header-hover\)/), 'the closed summary hover rule must remain');
  assert.ok(css.match(/\.author-menu summary\s*\{\s*padding:\s*8px/), 'the summary layout rule must remain');
});

test('the neighbouring author-menu hover rules are untouched', () => {
  assert.ok(css.match(/\.author-workspace\[data-chrome\] \.author-menu > button:hover:not\(:disabled\)\s*\{\s*background:\s*var\(--header-hover\)/), 'the menu-bar button hover must remain var(--header-hover)');
  assert.ok(css.match(/\.author-workspace\[data-chrome\] \.author-menu > button\[aria-pressed=true\]:hover:not\(:disabled\)\s*\{\s*background:\s*var\(--header-selected-hover\)/), 'the pressed menu-bar button hover must remain var(--header-selected-hover)');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="author-workspace">
      <nav class="author-menu" aria-label="Analysis menu">
        <details name="analysis-menu" open><summary id="open">File</summary><div class="menu-popover"></div></details>
        <details name="analysis-menu"><summary id="closed">Edit</summary><div class="menu-popover"></div></details>
      </nav>
    </div>
    <details open><summary id="outside">Outside</summary></details>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if ((rule.selectorText || '') === '.author-menu details[open] > summary:hover') rules.push(rule);
        }
      }
      const open = document.querySelector('#open');
      const closed = document.querySelector('#closed');
      const outside = document.querySelector('#outside');
      const rest = { background: getComputedStyle(open).backgroundColor, boxShadow: getComputedStyle(open).boxShadow, box: JSON.stringify(open.getBoundingClientRect().toJSON()) };
      const hover = rules[0];
      // A var() shorthand is stored only at shorthand level in CSSOM
      // (its longhand values read empty), so apply the shorthand
      // itself rather than copying longhands.
      if (hover) open.style.setProperty('background', hover.style.getPropertyValue('background'));
      const hovered = { background: getComputedStyle(open).backgroundColor, boxShadow: getComputedStyle(open).boxShadow, box: JSON.stringify(open.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        ruleText: rules.length ? rules[0].style.cssText : null,
        open: { rest, hovered },
        openMatches: open.matches('.author-menu details[open] > summary'),
        closedMatches: closed.matches('.author-menu details[open] > summary'),
        outsideMatches: outside.matches('.author-menu details[open] > summary'),
        closedBg: getComputedStyle(closed).backgroundColor,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.match(actual.ruleText, /var\(--header-hover\)/);
    assert.equal(actual.open.rest.background, 'rgb(11, 67, 95)');
    assert.equal(actual.open.hovered.background, 'rgb(18, 96, 128)');
    assert.notEqual(actual.open.rest.background, actual.open.hovered.background);
    assert.equal(actual.open.rest.boxShadow, actual.open.hovered.boxShadow, 'the open inset focus shadow must be unchanged');
    assert.notEqual(actual.open.rest.boxShadow, 'none', 'the open summary must keep its inset shadow at rest');
    assert.equal(actual.open.rest.box, actual.open.hovered.box);
    assert.ok(actual.openMatches);
    assert.equal(actual.closedMatches, false, 'a closed summary keeps the generic summary hover rule');
    assert.equal(actual.outsideMatches, false, 'an open summary outside .author-menu is out of scope');
    assert.notEqual(actual.closedBg, 'rgb(11, 67, 95)', 'closed summary resting state unchanged');
  });
}
