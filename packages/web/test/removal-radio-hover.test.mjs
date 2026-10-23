import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 102: hover feedback for the operator
// user-removal dialog's radio labels (.admin-settings [role=dialog]
// label wrapping its radio in OperatorUsers.tsx's RemovalPrompt —
// "Transfer schedules to another user" and "Stop schedules", inside
// the fieldset of section.automation-notice in main.admin-settings).
// They had zero hover feedback. Every :hover rule that reaches the
// dialog is scoped elsewhere or excludes them — the admin field hover
// (slice 59) reaches the dialog's select and text inputs but
// deliberately excludes radio inputs so native controls keep their OS
// rendering, and no label hover rule reached the dialog — so neither
// the labels nor their radios matched any :hover rule, while the
// dialog's buttons and select do step. A CSSOM probe with all five
// real stylesheets in the real ancestor context confirmed zero
// matching :hover rules for the radio labels and a transparent rest.
// The labels now take #edf7f7, the admin surface's established hover
// tint (the slice-59 admin button and field hovers, and the slice-87
// admin link hover), so no new colour is introduced. The rule is on
// the label, not the radio: the radio keeps its native rendering,
// following the slice-94 connector-toggle, slice-95 sign-in-check,
// slice-96 favorites-filter, slice-97 toggle-label, slice-98
// O-mode-label, slice-99 parameter-checkbox, slice-100
// action-checkbox and slice-101 action-radio precedents where the
// label surface hovers and its inner input does not. The
// :has(> input[type=radio]) scope (the slice-99/100/101 precedent)
// targets exactly the radio labels; the "New schedule owner" label in
// the same fieldset stays out of scope because its select already
// hovers via the admin select hover. The admin surface is fixed
// light, so no dark variant. Background only, so resting geometry is
// identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const rule = styleCss.match(/^\.admin-settings \[role="dialog"\] label:has\(> input\[type=radio\]\):hover\s*\{([^}]*)\}/m);

test('the removal dialog radio label hover rule exists and uses the established hover tint', () => {
  assert.ok(rule, 'expected the .admin-settings [role=dialog] radio label :hover rule');
  assert.match(rule[1], /background:\s*#edf7f7/);
});

test('the hover tint matches the admin button and field hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.admin-settings button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the admin button hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.admin-settings input:hover:not\(:disabled\):not\(\[type=radio\]\):not\(\[type=checkbox\]\)/), 'the admin field hover must remain and keep its radio exclusion');
});

test('the removal dialog radio label hover rule is paint-only: resting geometry and label presentation cannot shift', () => {
  assert.ok(rule, 'expected the hover rule');
  assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(rule[1]), 'hover must change background only');
});

test('the resting removal dialog rules are preserved and the radio has no hover rule of its own', () => {
  assert.ok(styleCss.match(/\.admin-settings \[role="dialog"\] label:has\(input\[type="radio"\]\)\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/), 'the dialog radio label resting rule must remain');
  assert.ok(styleCss.match(/\.admin-settings \[role="dialog"\] input\[type="radio"\]\s*\{[^}]*width:\s*auto/), 'the dialog radio resting rule must remain');
  assert.ok(!/\.admin-settings \[role="dialog"\] input:hover/.test(styleCss), 'the radio must keep its native rendering with no hover rule of its own');
  assert.ok(!/data-chrome=dark[^\n]*removal|\.admin-settings \[data-chrome/.test(styleCss), 'the fixed-light admin surface must not gain a dark variant for this rule');
});

describe('Removal dialog radio label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rule changes the label visual state with identical geometry in the real ancestor context, and the radio, the owner label and outside labels are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<main class="admin-settings"><section role="dialog" class="automation-notice"><h2>Remove user u1</h2>`
      + `<fieldset><legend>Owned schedules</legend>`
      + `<label id="transferLabel"><input id="transferRadio" type="radio" name="job-disposition">Transfer schedules to another user</label>`
      + `<label id="ownerLabel">New schedule owner<select aria-label="New schedule owner"><option>Choose a user</option></select></label>`
      + `<label id="stopLabel"><input type="radio" name="job-disposition">Stop schedules</label>`
      + `</fieldset></section>`
      + `<label id="outsideLabel"><input type="radio">Other label</label></main>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const found = all.find(r => norm(r) === '.admin-settings [role=dialog] label:has(> input[type=radio]):hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const bare = found ? found.selectorText.replaceAll(':hover', '') : '';
      const el = id => document.querySelector(`#${id}`);
      return {
        found: !!found,
        props: found ? [...found.style] : [],
        transfer: found ? measure(el('transferLabel'), found) : null,
        stop: found ? measure(el('stopLabel'), found) : null,
        radioMatches: found ? el('transferRadio').matches(bare) : null,
        ownerMatches: found ? el('ownerLabel').matches(bare) : null,
        outsideMatches: found ? el('outsideLabel').matches(bare) : null,
      };
    });
    assert.ok(actual.found, 'expected the hover rule in the CSSOM');
    assert.ok(actual.props.length && actual.props.every(p => p.startsWith('background')), 'hover rule must set background longhands only');
    for (const [name, ctx] of [['transfer', actual.transfer], ['stop', actual.stop]]) {
      assert.equal(ctx.rest.background, 'rgba(0, 0, 0, 0)', `${name} label rest (transparent)`);
      assert.equal(ctx.hovered.background, 'rgb(237, 247, 247)', `${name} label hover`);
      assert.notEqual(ctx.rest.background, ctx.hovered.background);
      assert.equal(ctx.rest.color, ctx.hovered.color, `${name} label colour unchanged on hover`);
      assert.equal(ctx.rest.box, ctx.hovered.box, `${name} label geometry`);
    }
    assert.equal(actual.radioMatches, false, 'the radio inside the label must be out of scope');
    assert.equal(actual.ownerMatches, false, 'the schedule-owner label in the same fieldset must be out of scope (its select already hovers)');
    assert.equal(actual.outsideMatches, false, 'a radio label outside the admin dialog must be out of scope');
  });
});
