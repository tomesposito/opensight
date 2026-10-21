import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 78: hover feedback for the sheet text
// object's pressed style toggles (.object-text-style
// button[aria-pressed="true"] in SheetObjectCard.tsx's
// SheetObjectProperties — Bold / Italic / Underline). The one rule
// that styles them pairs the pressed rest and hover in a single
// declaration at #166f7a, and its (0,4,1) hover variant beats the
// author generic hover (#edf7f7, (0,3,1)), so hovering a pressed
// toggle changed nothing, while every unpressed toggle steps
// transparent -> #edf7f7. The group only renders while a text sheet
// object is selected, so route audits never reach it. Following the
// slices 28/29/73-77 selected-control language, the pressed toggle
// now takes a dedicated hover step one visible step deeper than its
// #166f7a rest: #126e76, the app-wide primary hover step (slices
// 51/57/66), so no new color is introduced. Background only, so the
// white label is kept and resting geometry is identical; static
// (no animation), so no reduced-motion variant.
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

const rule = css.match(/\.author-layout \.object-text-style button\[aria-pressed="true"\]:hover:not\(:disabled\)\s*\{([^}]*)\}/);

test('the pressed text-style toggle hover rule exists and uses the primary hover step', () => {
  assert.ok(rule, 'expected the .object-text-style button[aria-pressed="true"]:hover rule');
  assert.match(rule[1], /background:\s*#126e76/);
});

test('the hover tint is the established primary hover step, deeper than the pressed rest tint', () => {
  assert.ok(css.match(/\.author-workspace \.primary-button:hover:not\(:disabled\)\s*\{\s*background:\s*#126e76/), 'the primary-button hover step must remain #126e76');
  const pressed = css.match(/\.author-layout \.object-text-style button\[aria-pressed="true"\], \.author-layout \.object-text-style button\[aria-pressed="true"\]:hover\s*\{([^}]*)\}/);
  assert.ok(pressed, 'expected the paired pressed resting rule');
  assert.match(pressed[1], /background:\s*#166f7a/);
  assert.notEqual('#126e76', '#166f7a', 'the hover tint must differ from the resting tint');
});

test('the pressed-toggle hover rule is paint-only: resting geometry cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting toggle rules are preserved', () => {
  const pressed = css.match(/\.author-layout \.object-text-style button\[aria-pressed="true"\], \.author-layout \.object-text-style button\[aria-pressed="true"\]:hover\s*\{([^}]*)\}/);
  assert.ok(pressed, 'expected the paired pressed resting rule');
  assert.match(pressed[1], /background:\s*#166f7a/);
  assert.match(pressed[1], /color:\s*white/);
  assert.ok(css.match(/\.object-text-style\s*\{\s*display:\s*flex/), 'the text-style group layout must remain');
});

test('the neighbouring author hover rules are untouched', () => {
  assert.ok(css.match(/\.author-workspace button:hover:not\(:disabled\), \.author-layout button:hover:not\(:disabled\)\s*\{\s*border-color:\s*#157f88;\s*background:\s*#edf7f7/), 'the author generic hover must remain #edf7f7');
  assert.ok(css.match(/\.author-workspace \.primary-button:hover:not\(:disabled\)\s*\{\s*background:\s*#126e76;\s*color:\s*white/), 'the author primary hover must remain');
});

{
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the visual state with identical geometry', async () => {
    await page.setContent(`<style>${css}</style><div class="author-layout">
      <div class="object-text-style" role="group" aria-label="Text style">
        <button type="button" id="pressed" aria-pressed="true">B</button>
        <button type="button" id="plain" aria-pressed="false">I</button>
      </div>
      <button type="button" id="outside" aria-pressed="true">X</button>
    </div>`);
    const actual = await page.evaluate(() => {
      const rules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          const sel = (rule.selectorText || '').replace(/"/g, '');
          if (sel === '.author-layout .object-text-style button[aria-pressed=true]:hover:not(:disabled)') rules.push(rule);
        }
      }
      const pressed = document.querySelector('#pressed');
      const plain = document.querySelector('#plain');
      const outside = document.querySelector('#outside');
      const rest = { background: getComputedStyle(pressed).backgroundColor, color: getComputedStyle(pressed).color, box: JSON.stringify(pressed.getBoundingClientRect().toJSON()) };
      const hover = rules[0];
      if (hover) for (const prop of hover.style) pressed.style.setProperty(prop, hover.style.getPropertyValue(prop));
      const hovered = { background: getComputedStyle(pressed).backgroundColor, color: getComputedStyle(pressed).color, box: JSON.stringify(pressed.getBoundingClientRect().toJSON()) };
      return {
        ruleCount: rules.length,
        props: rules.length ? [...rules[0].style] : [],
        backgroundColor: rules.length ? rules[0].style.getPropertyValue('background-color') : null,
        pressed: { rest, hovered },
        pressedMatches: pressed.matches('.author-layout .object-text-style button[aria-pressed="true"]:not(:disabled)'),
        plainMatches: plain.matches('.author-layout .object-text-style button[aria-pressed="true"]:not(:disabled)'),
        outsideMatches: outside.matches('.author-layout .object-text-style button[aria-pressed="true"]:not(:disabled)'),
        plainBg: getComputedStyle(plain).backgroundColor,
      };
    });
    assert.equal(actual.ruleCount, 1);
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    assert.equal(actual.backgroundColor, 'rgb(18, 110, 118)');
    assert.equal(actual.pressed.rest.background, 'rgb(22, 111, 122)');
    assert.equal(actual.pressed.hovered.background, 'rgb(18, 110, 118)');
    assert.notEqual(actual.pressed.rest.background, actual.pressed.hovered.background);
    assert.equal(actual.pressed.rest.color, actual.pressed.hovered.color, 'the white label must be unchanged');
    assert.equal(actual.pressed.rest.box, actual.pressed.hovered.box);
    assert.ok(actual.pressedMatches);
    assert.equal(actual.plainMatches, false, 'unpressed toggle keeps the author generic hover rule');
    assert.equal(actual.outsideMatches, false, 'a pressed button outside the text-style group is out of scope');
    assert.notEqual(actual.plainBg, 'rgb(22, 111, 122)', 'unpressed toggle resting state unchanged');
  });
}
