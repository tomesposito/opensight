import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';

// Issue #108 polish slice 123: hover feedback for the draft-source
// recovery banner's label (.draft-source-recovery label —
// "Replacement dataset" in DraftSource.tsx's DraftSourceRecovery
// aside, rendered as a direct child of .author-workspace in
// Author.tsx when a saved draft's source data is unavailable). The
// label had zero hover feedback: the author select hover (slice 36)
// and the author button hover reach the controls inside the banner,
// but every label :hover rule in the cascade is scoped elsewhere
// (property-section, parameter-editor, control-form,
// calculation/analysis-file/data dialogs, prep labels,
// connector/sign-in/collection labels, admin labels, embed labels,
// the action panel body, the api picker), so the label rested
// transparent and hovering its text changed nothing, while only the
// select inside it tinted. A CSSOM probe with all five real
// stylesheets (1,391 rules) in the real ancestor contexts
// (.author-workspace in light and dark chrome >
// aside.draft-source-recovery > label) confirmed zero matching
// :hover rules for the label in both chromes and a transparent rest,
// while the inner select matched the author select hovers and the
// banner's buttons matched the author button hover. The label now
// takes #edf7f7, the author surface's established hover tint (its
// select/button/field/label hovers), plus the author dark-chrome
// variant #334c62, so no new colour is introduced — and because the
// label and the select inside it take the same tint, hovering either
// reads as one surface, not two steps. Background only, so resting
// geometry is identical and there is no animation.
const styleCss = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const allCss = (await Promise.all(['style.css', 'app-chrome.css', 'data-section.css', 'embed.css', 'sign-in.css']
  .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');

const labelRule = styleCss.match(/^\.draft-source-recovery label:hover\s*\{([^}]*)\}/m);
const labelDarkRule = styleCss.match(/^\.author-workspace\[data-chrome=dark\] \.draft-source-recovery label:hover\s*\{([^}]*)\}/m);

test('the draft-source label hover rules exist and use the established hover tints', () => {
  assert.ok(labelRule, 'expected the draft-source-recovery label :hover rule');
  assert.match(labelRule[1], /background:\s*#edf7f7/);
  assert.ok(labelDarkRule, 'expected the author dark-chrome draft-source label :hover variant');
  assert.match(labelDarkRule[1], /background:\s*#334c62/);
});

test('the hover tints match the author select hovers, so no new colour is introduced', () => {
  assert.ok(styleCss.match(/\.author-workspace select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author select hover must remain #edf7f7');
  assert.ok(styleCss.match(/\.author-workspace\[data-chrome=dark\] select:hover:not\(:disabled\)\s*\{[^}]*background:\s*#334c62/), 'the author dark select hover must remain #334c62');
  assert.ok(styleCss.match(/\.author-workspace button:hover:not\(:disabled\),\s*\.author-layout button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#edf7f7/), 'the author button hover must remain #edf7f7');
});

test('the draft-source label hover rules are paint-only: resting geometry and presentation cannot shift', () => {
  for (const r of [labelRule, labelDarkRule]) {
    assert.ok(r, 'expected both hover rules');
    assert.ok(!/padding|margin|border|width|height|font|box-shadow|color:/.test(r[1]), 'hover must change background only');
  }
});

test('the resting draft-source-recovery rules are preserved', () => {
  assert.ok(styleCss.match(/\.draft-source-recovery\s*\{[^}]*background:\s*#fff8e6/), 'the resting banner rule must remain');
  assert.ok(styleCss.match(/\.draft-source-recovery button,\s*\.draft-source-recovery label\s*\{[^}]*margin:\s*4px 8px 4px 0/), 'the resting banner control margin rule must remain');
  assert.ok(styleCss.match(/\.draft-source-recovery select\s*\{[^}]*max-width:\s*100%/), 'the resting banner select rule must remain');
});

describe('Draft-source label hover in offline Chromium', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('applying the hover rules changes the label visual state with identical geometry in the real ancestor contexts, and labels outside the banner are out of scope', async () => {
    await page.setContent(`<style>${allCss}</style>`
      + `<div class="author-workspace"><aside class="draft-source-recovery"><label id="lightLabel">Replacement dataset<select><option>Choose a compatible dataset…</option></select></label></aside></div>`
      + `<div class="author-workspace" data-chrome="dark"><aside class="draft-source-recovery"><label id="darkLabel">Replacement dataset<select><option>Choose a compatible dataset…</option></select></label></aside></div>`
      + `<div class="author-workspace"><label id="outsideLabel">Outside<select><option>Other</option></select></label></div>`);
    const actual = await page.evaluate(() => {
      const all = [...document.styleSheets].flatMap(s => [...s.cssRules]);
      const norm = r => (r.selectorText || '').replaceAll('"', '');
      const label = all.find(r => norm(r) === '.draft-source-recovery label:hover') ?? null;
      const labelDark = all.find(r => norm(r) === '.author-workspace[data-chrome=dark] .draft-source-recovery label:hover') ?? null;
      const measure = (el, rule) => {
        const rest = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        if (rule) { for (const prop of rule.style) el.style.setProperty(prop, rule.style.getPropertyValue(prop)); }
        const hovered = { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, box: JSON.stringify(el.getBoundingClientRect().toJSON()) };
        el.removeAttribute('style');
        return { rest, hovered };
      };
      const el = id => document.querySelector(`#${id}`);
      return {
        found: { label: !!label, labelDark: !!labelDark },
        props: [label, labelDark].map(r => r ? [...r.style] : []),
        lightLabel: label ? measure(el('lightLabel'), label) : null,
        darkLabel: labelDark ? measure(el('darkLabel'), labelDark) : null,
        outsideLabelMatches: label ? el('outsideLabel').matches(label.selectorText.replaceAll(':hover', '')) : null,
        outsideDarkMatches: labelDark ? el('outsideLabel').matches(labelDark.selectorText.replaceAll(':hover', '')) : null,
      };
    });
    assert.deepEqual(actual.found, { label: true, labelDark: true }, 'expected both hover rules in the CSSOM');
    for (const props of actual.props) {
      assert.ok(props.length && props.every(p => p.startsWith('background')), 'hover rules must set background longhands only');
    }
    assert.equal(actual.lightLabel.rest.background, 'rgba(0, 0, 0, 0)', 'light label rest');
    assert.equal(actual.lightLabel.hovered.background, 'rgb(237, 247, 247)', 'light label hover');
    assert.notEqual(actual.lightLabel.rest.background, actual.lightLabel.hovered.background);
    assert.equal(actual.lightLabel.rest.color, actual.lightLabel.hovered.color, 'light label colour unchanged on hover');
    assert.equal(actual.lightLabel.rest.box, actual.lightLabel.hovered.box, 'light label geometry');
    assert.equal(actual.darkLabel.rest.background, 'rgba(0, 0, 0, 0)', 'dark label rest');
    assert.equal(actual.darkLabel.hovered.background, 'rgb(51, 76, 98)', 'dark label hover');
    assert.equal(actual.darkLabel.rest.color, actual.darkLabel.hovered.color, 'dark label colour unchanged on hover');
    assert.equal(actual.darkLabel.rest.box, actual.darkLabel.hovered.box, 'dark label geometry');
    assert.equal(actual.outsideLabelMatches, false, 'a label outside .draft-source-recovery must be out of scope');
    assert.equal(actual.outsideDarkMatches, false, 'a label outside .draft-source-recovery must be out of scope for the dark variant');
  });
});
